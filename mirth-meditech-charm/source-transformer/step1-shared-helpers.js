/**
 * SOURCE TRANSFORMER - STEP 1 (JavaScript): Shared helpers & validation
 *
 * Must be the FIRST step. Steps 2 (A08) and 3 (A31) use the functions and
 * variables defined here (Mirth runs all transformer steps in one shared scope).
 *
 * Do NOT use `return` at the top level of any step - it would stop the
 * remaining steps from running.
 */

/* ===================== Configuration ===================== */
var charmOptions = {
    legacyEmptyDateDefaults: false,
    processingTimeZone: '',
    facilityResolver: null
};

// false = source Outbound data type is Raw
// true  = source Outbound data type is HL7 v2.x
var CHARM_OUTBOUND_HL7V2 = false;

// What to do with messages the old source filter would have rejected
// (not ADT A08/A31, site not allowed, or no MR identifier):
// false = log it and send it to no destination (closest to the old filter)
// true  = throw an error, so the message shows as ERROR in the dashboard
var CHARM_REJECT_AS_ERROR = false;

var CHARM_VALID_SITES = 'HPH SGP SCU WRP PPH PGC WGP JFP JHC BEL LMP NOH NWB CPH CBP STA NPH WVP SPP PHC BAR NWP GPH NPE GLE WPH'.split(' ');

/* ===================== HL7 parsing helpers ===================== */
function HL7_normalize(raw) {
    raw = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    if (raw.substring(0, 8) !== 'MSH|^~\\&') {
        throw new Error('Unsupported HL7 delimiters; expected MSH|^~\\&.');
    }
    return raw;
}

function HL7_parse(raw) {
    var segments = {}, order = [], lines = raw.split('\r');
    for (var i = 0; i < lines.length; i++) {
        if (lines[i] === '') { continue; }
        var tokens = lines[i].split('|');
        var tag = tokens[0];
        if (!/^[A-Z0-9]{3}$/.test(tag) &&
            !(String(lines[0].split('|')[8] || '').split('^')[1] === 'A31' && /^Z[A-Z0-9]{2,}$/.test(tag))) {
            throw new Error('Invalid HL7 segment identifier at line ' + (i + 1) + '.');
        }
        if (!segments[tag]) { segments[tag] = []; }
        segments[tag].push(tokens);
        order.push(tag);
    }
    return { segments: segments, order: order, lines: lines };
}

function HL7_field(segments, tag, n, r) {
    var list = segments[tag], row = list && list[r || 0];
    return row ? (row[tag === 'MSH' ? n - 1 : n] || '') : '';
}

function HL7_repeat(value, r) { return String(value || '').split('~')[r || 0] || ''; }
function HL7_component(value, n) { return String(value || '').split('^')[n - 1] || ''; }
function HL7_subcomponent(value, n) { return String(value || '').split('&')[n - 1] || ''; }

function HL7_value(segments, tag, n, component, r) {
    return HL7_subcomponent(HL7_component(HL7_repeat(HL7_field(segments, tag, n, r)), component || 1), 1);
}

/* ===================== HL7 build helpers ===================== */
function HL7_pad(values, length, separator) {
    var a = values.slice(0, length);
    while (a.length < length) { a.push(''); }
    return a.join(separator);
}

function HL7_seg(tag, count) {
    var a = [tag];
    while (a.length <= count) { a.push(''); }
    return a;
}

function HL7_emit(a) { return a.join('|') + '|'; }

/* ===================== HL7 datetime helpers ===================== */
function HL7_validClock(stamp) {
    return /^\d{14}$/.test(String(stamp || ''));
}

function HL7_dateValue(value, dateOnly, label, allowCurrentDefault, ctx) {
    ctx = ctx || {};
    var options = ctx.options || {};
    var warnings = ctx.warnings || [];
    var defaults = ctx.defaults || [];
    var processingTimestamp = ctx.processingTimestamp;

    value = String(value || '');
    if (value === '""') { return value; }
    if (value === '' || value === 'NULL') {
        if (allowCurrentDefault && options.legacyEmptyDateDefaults === true) {
            defaults.push(label);
            return dateOnly ? processingTimestamp.substring(0, 8) : processingTimestamp;
        }
        return '';
    }

    if (value === '0000-00-00 00:00:00') { return ''; }
    var match = /^(\d{8}|\d{10}|\d{12}|\d{14})(?:\.(\d{1,4}))?([+-]\d{4})?$/.exec(value);
    if (!match) {
        throw new Error('Unsupported or invalid timestamp in ' + label + '.');
    }

    var digits = match[1];
    var year = Number(digits.substring(0, 4));
    var month = Number(digits.substring(4, 6));
    var day = Number(digits.substring(6, 8));
    var check = new Date(Date.UTC(year, month - 1, day));

    if (year < 1900 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        throw new Error('Invalid calendar date in ' + label + '.');
    }

    if ((digits.length >= 10 && Number(digits.substring(8, 10)) > 23) ||
        (digits.length >= 12 && Number(digits.substring(10, 12)) > 59) ||
        (digits.length >= 14 && Number(digits.substring(12, 14)) > 59)) {
        throw new Error('Invalid time in ' + label + '.');
    }

    if (match[3] && (Number(match[3].substring(1, 3)) > 23 || Number(match[3].substring(3, 5)) > 59)) {
        throw new Error('Invalid timezone offset in ' + label + '.');
    }

    if (dateOnly) { return digits.substring(0, 8) === '19000101' ? '' : digits.substring(0, 8); }

    while (digits.length < 14) { digits += '0'; }
    if (match[2] || match[3]) {
        warnings.push(label + ': fractional seconds or explicit offset preserved; Lua timezone equivalence is not established.');
    }

    return digits + (match[2] ? '.' + match[2] : '') + (match[3] || '');
}

/* ===================== Shared context & validation ===================== */
function mtcInit(raw, options, processingTimestamp) {
    options = options || {};
    var parsed = HL7_parse(HL7_normalize(raw));
    var segments = parsed.segments;

    var ctx = {
        options: options,
        processingTimestamp: processingTimestamp,
        segments: segments,
        order: parsed.order,
        lines: parsed.lines,
        warnings: [],
        defaults: []
    };

    ctx.f = function (tag, n, r) { return HL7_field(segments, tag, n, r); };
    ctx.repeat = function (value, r) { return HL7_repeat(value, r); };
    ctx.c = function (value, n) { return HL7_component(value, n); };
    ctx.sub = function (value, n) { return HL7_subcomponent(value, n); };
    ctx.v = function (tag, n, component, r) { return HL7_value(segments, tag, n, component, r); };
    ctx.pad = function (values, length, separator) { return HL7_pad(values, length, separator); };
    ctx.seg = function (tag, count) { return HL7_seg(tag, count); };
    ctx.emit = function (a) { return HL7_emit(a); };

    var dateCtx = {
        processingTimestamp: processingTimestamp,
        options: options,
        warnings: ctx.warnings,
        defaults: ctx.defaults
    };
    ctx.dateValue = function (value, dateOnly, label, allowCurrentDefault) {
        return HL7_dateValue(value, dateOnly, label, allowCurrentDefault, dateCtx);
    };
    ctx.ts = function (tag, n, label, allowDefault) {
        return ctx.dateValue(ctx.v(tag, n), false, label, allowDefault);
    };
    ctx.copyScalar = function (out, tag, fields, r) {
        for (var k = 0; k < fields.length; k++) { out[fields[k]] = ctx.v(tag, fields[k], 1, r); }
    };
    return ctx;
}

function mtcValidateAndExtract(ctx) {
    var f = ctx.f, c = ctx.c, v = ctx.v, sub = ctx.sub, repeat = ctx.repeat, segments = ctx.segments;
    var sites = 'HPH SGP SCU WRP PPH PGC WGP JFP JHC BEL LMP NOH NWB CPH CBP STA NPH WVP SPP PHC BAR NWP GPH NPE GLE WPH'.split(' ');

    if (!segments.MSH || segments.MSH.length !== 1 || !segments.PID || segments.PID.length !== 1) {
        throw new Error('Exactly one MSH and one PID segment are required.');
    }
    if (!HL7_validClock(ctx.processingTimestamp)) {
        throw new Error('A 14-digit processing timestamp is required.');
    }

    var sourceEvent = c(f('MSH', 9), 2);
    var site = v('MSH', 4) || sub(c(repeat(f('PID', 3)), 6), 1);
    if (c(f('MSH', 9), 1) !== 'ADT' || (sourceEvent !== 'A08' && sourceEvent !== 'A31')) {
        throw new Error('Only ADT A08 and ADT A31 messages are supported.');
    }
    if (sites.indexOf(site) < 0) { throw new Error('The input site is not allowed.'); }

    var ids = {}, identifierRows = f('PID', 3).split('~');
    for (var i = 0; i < identifierRows.length; i++) {
        var type = c(identifierRows[i], 5);
        if (!Object.prototype.hasOwnProperty.call(ids, type)) { ids[type] = c(identifierRows[i], 1); }
    }
    if (!Object.prototype.hasOwnProperty.call(ids, 'MR')) { throw new Error('PID-3 must contain an MR identifier.'); }
    if (ids.MR === '') { throw new Error('The MR identifier must contain an ID value.'); }
    if (v('MSH', 10) === '') { throw new Error('MSH-10 must contain a message control ID.'); }

    return { sourceEvent: sourceEvent, site: site, ids: ids };
}

/*
 * Replaces the old source filter. Reads the raw ER7 text (not `msg`), so it
 * works with any inbound data type. Returns { accepted, site, event, hasMR }.
 */
function charmFilterCheck(raw) {
    var text = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    var lines = text.split('\r');
    var msh = null, pid = null;
    for (var i = 0; i < lines.length; i++) {
        var tag = lines[i].substring(0, 4);
        if (tag === 'MSH|' && msh === null) { msh = lines[i].split('|'); }
        if (tag === 'PID|' && pid === null) { pid = lines[i].split('|'); }
    }
    function first(value) { return HL7_subcomponent(HL7_repeat(value, 0).split('^')[0], 1); }

    // MSH-n is token n-1 (the field separator is MSH-1); other segments use token n.
    var mshType = msh ? (msh[8] || '') : '';
    var messageCode = HL7_subcomponent(HL7_component(HL7_repeat(mshType, 0), 1), 1);
    var event = HL7_subcomponent(HL7_component(HL7_repeat(mshType, 0), 2), 1);

    var site = msh ? first(msh[3] || '') : '';
    var pid3 = pid ? (pid[3] || '') : '';
    if (site === '') {
        site = HL7_subcomponent(HL7_component(HL7_repeat(pid3, 0), 6), 1);
    }

    var hasMR = false;
    var reps = pid3 === '' ? [] : pid3.split('~');
    for (var r = 0; r < reps.length; r++) {
        if (HL7_subcomponent(HL7_component(reps[r], 5), 1) === 'MR') { hasMR = true; break; }
    }

    var accepted = messageCode === 'ADT' &&
        (event === 'A08' || event === 'A31') &&
        CHARM_VALID_SITES.indexOf(site) >= 0 &&
        hasMR;

    return { accepted: accepted, site: site, event: event, hasMR: hasMR };
}

/* Logs warnings and returns the value to assign to `tmp`. */
function charmOutput(result) {
    if (result.warnings && result.warnings.length) {
        logger.info('Charm convert [' + result.site + '/' + result.event + '] warnings: ' +
            result.warnings.join(' | '));
    }
    channelMap.put('charmHl7', result.hl7);
    if (CHARM_OUTBOUND_HL7V2) {
        return new XML(SerializerFactory.getSerializer('HL7V2').toXML(result.hl7));
    }
    return result.hl7;
}

/* ===================== Run shared setup ===================== */
var charmZone = charmOptions.processingTimeZone === ''
    ? java.time.ZoneId.systemDefault()
    : java.time.ZoneId.of(charmOptions.processingTimeZone);

var charmClock = String(java.time.format.DateTimeFormatter.ofPattern('yyyyMMddHHmmss')
    .format(java.time.ZonedDateTime.now(charmZone)));

var charmRaw = String(connectorMessage.getRawData());
var charmCtx = null;
var charmMeta = null;      // set only for accepted messages; steps 2 and 3 check it
var charmResult = null;

// Same checks as the old source filter.
var charmGate = charmFilterCheck(charmRaw);
channelMap.put('siteCode', charmGate.site);
channelMap.put('triggerEvent', charmGate.event);

if (charmGate.accepted) {
    charmCtx = mtcInit(charmRaw, charmOptions, charmClock);
    charmMeta = mtcValidateAndExtract(charmCtx);   // site, sourceEvent ('A08' / 'A31'), ids
} else {
    var charmRejectText = 'Meditech-to-Charm filtered: event=' + charmGate.event +
        ', site=' + charmGate.site + ', hasMR=' + charmGate.hasMR;
    if (CHARM_REJECT_AS_ERROR) {
        throw new Error(charmRejectText);
    }
    logger.info(charmRejectText);
    destinationSet.removeAll();   // don't send to any destination (like a filter)
}
