/**
 * Library: Meditech to Charm Converter
 * Code Template: MeditechToCharm
 *
 * Converts HL7 Messages in Meditech Format into Charm Format.
 * Only receives ADT-08 & ADT-31 Messages; returns ADT-08 in Charm Format.
 *
 * Depends on (link these libraries to the same channel):
 *   - HL7Parser   : HL7_normalize, HL7_parse, HL7_field, HL7_repeat,
 *                   HL7_component, HL7_subcomponent, HL7_value
 *   - HL7DateTime : HL7_validClock, HL7_dateValue
 *   - HL7Builder  : HL7_pad, HL7_seg, HL7_emit
 *
 * Behavior is identical to the original monolithic convertMeditechToCharm;
 * only the shared helpers have been extracted into libraries.
 */
function convertMeditechToCharm(raw, options, processingTimestamp) {
    options = options || {};
    var warnings = [];
    var defaults = [];
    var sites = 'HPH SGP SCU WRP PPH PGC WGP JFP JHC BEL LMP NOH NWB CPH CBP STA NPH WVP SPP PHC BAR NWP GPH NPE GLE WPH'.split(' ');

    raw = HL7_normalize(raw);

    var parsed = HL7_parse(raw);
    var segments = parsed.segments;
    var order = parsed.order;
    var lines = parsed.lines;

    if (!segments.MSH || segments.MSH.length !== 1 || !segments.PID || segments.PID.length !== 1) {
        throw new Error('Exactly one MSH and one PID segment are required.');
    }

    // --- Local shims so the body below reads like the original closures. ---
    function f(tag, n, r) { return HL7_field(segments, tag, n, r); }
    function repeat(value, r) { return HL7_repeat(value, r); }
    function c(value, n) { return HL7_component(value, n); }
    function sub(value, n) { return HL7_subcomponent(value, n); }
    function v(tag, n, component, r) { return HL7_value(segments, tag, n, component, r); }
    function pad(values, length, separator) { return HL7_pad(values, length, separator); }
    function seg(tag, count) { return HL7_seg(tag, count); }
    function emit(a) { return HL7_emit(a); }

    function copyScalar(out, tag, fields, r) {
        for (var k = 0; k < fields.length; k++) { out[fields[k]] = v(tag, fields[k], 1, r); }
    }

    var dateCtx = {
        processingTimestamp: processingTimestamp,
        options: options,
        warnings: warnings,
        defaults: defaults
    };
    function dateValue(value, dateOnly, label, allowCurrentDefault) {
        return HL7_dateValue(value, dateOnly, label, allowCurrentDefault, dateCtx);
    }
    function ts(tag, n, label, allowDefault) { return dateValue(v(tag, n), false, label, allowDefault); }

    if (!HL7_validClock(processingTimestamp)) {
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

    /* A31-only conversion. The existing A08 implementation below is unchanged. */
    if (sourceEvent === 'A31') {
        var a31Rows = [];
        for (var a31Line = 0; a31Line < lines.length; a31Line++) {
            if (lines[a31Line] !== '') { a31Rows.push(lines[a31Line].split('|')); }
        }
        function a31Field(row, number) {
            return row[row[0] === 'MSH' ? number - 1 : number] || '';
        }
        function a31Set(row, number, value) {
            var index = row[0] === 'MSH' ? number - 1 : number;
            while (row.length <= index) { row.push(''); }
            row[index] = String(value);
        }
        function a31Date(row, number) {
            var value = a31Field(row, number);
            if (value === '' || value === '""') { return; }
            var parts = value.split('^');
            parts[0] = dateValue(parts[0], false, row[0] + '-' + number, false);
            a31Set(row, number, parts.join('^'));
        }
        var a31Msh = segments.MSH[0];
        var a31Pid = segments.PID[0];
        // Use copies in source order, not a newly constructed output template.
        for (var ar = 0; ar < a31Rows.length; ar++) {
            if (a31Rows[ar][0] === 'MSH') { a31Msh = a31Rows[ar]; }
            if (a31Rows[ar][0] === 'PID') { a31Pid = a31Rows[ar]; }
        }
        a31Set(a31Msh, 9, 'ADT^A08');
        a31Date(a31Msh, 7);
        // Preserve MSH-11 and unrelated source fields. Apply Charm header constants.
        a31Set(a31Msh, 12, '2.4');
        a31Set(a31Msh, 13, '1');
        a31Set(a31Msh, 15, 'AL');
        a31Set(a31Msh, 16, 'NE');
        a31Set(a31Msh, 17, 'AU');
        a31Set(a31Msh, 18, 'ASCII');
        a31Set(a31Msh, 19, 'ENG^English');
        if (a31Field(a31Msh, 4) === '') { a31Set(a31Msh, 4, site); }

        // Keep every PID-3 repetition, including EMR, PT and existing SS values.
        var a31Identifiers = a31Field(a31Pid, 3).split('~');
        var a31FirstIdentifier = a31Identifiers[0].split('^');
        if (sub(c(a31Identifiers[0], 6), 1) === '' && c(a31Identifiers[0], 6) === '') {
            while (a31FirstIdentifier.length < 6) { a31FirstIdentifier.push(''); }
            a31FirstIdentifier[5] = site;
            a31Identifiers[0] = a31FirstIdentifier.join('^');
            a31Set(a31Pid, 3, a31Identifiers.join('~'));
        }
        // Do not concatenate PID-19 into CX.1 or manufacture an SS identifier.
        if (a31Field(a31Pid, 19).indexOf('^') >= 0) {
            warnings.push('PID-19 contains component separators; preserved unchanged and not converted into an SS identifier.');
        }
        if (a31Field(a31Pid, 29) !== '' && a31Field(a31Pid, 29) !== '""' && a31Field(a31Pid, 30) === '') {
            a31Set(a31Pid, 30, 'Y');
        }

        var a31ZcdAllowed = 'ZADPTTITLE ADPTMCEXP ADPTPENSTA ADPTPENS ADPTDVACAR ADPTDVANUM ZADPTWORKP ADPTSNET'.split(' ');
        var a31ExistingZcd = [], a31NextId = 1, a31NewZcd = [];
        for (ar = 0; ar < a31Rows.length; ar++) {
            var a31Row = a31Rows[ar];
            if (a31Row[0] === 'EVN') {
                a31Set(a31Row, 1, 'A08');
                a31Date(a31Row, 2); a31Date(a31Row, 3); a31Date(a31Row, 6);
            } else if (a31Row[0] === 'PV1') {
                a31Date(a31Row, 44); a31Date(a31Row, 45);
            } else if (a31Row[0] === 'ZCD') {
                a31ExistingZcd.push(a31Row);
                var a31Id = parseInt(a31Field(a31Row, 1), 10);
                if (!isNaN(a31Id) && a31Id >= a31NextId) { a31NextId = a31Id + 1; }
            }
        }
        function a31HasZcd(key, value) {
            for (var az = 0; az < a31ExistingZcd.length; az++) {
                if (a31Field(a31ExistingZcd[az], 2) === key && a31Field(a31ExistingZcd[az], 3) === value) { return true; }
            }
            return false;
        }
        for (ar = 0; ar < a31Rows.length; ar++) {
            var a31SourceRow = a31Rows[ar];
            if (a31SourceRow[0] !== 'ZQDS') { continue; }
            for (var aq = 1; aq < a31SourceRow.length; aq++) {
                var a31Pair = String(a31SourceRow[aq] || '').split('~');
                var a31Key = sub(c(a31Pair[0], 1), 1);
                var a31Value = sub(c(a31Pair[1], 1), 1);
                if (a31ZcdAllowed.indexOf(a31Key) >= 0 && !a31HasZcd(a31Key, a31Value)) {
                    var a31Zcd = ['ZCD', String(a31NextId++), a31Key, a31Value, ''];
                    a31NewZcd.push(a31Zcd); a31ExistingZcd.push(a31Zcd);
                }
                if (a31Key === 'ZADPTOTHPH') {
                    warnings.push('A31 mobile mapping requires verification; source PID phone fields and ZQDS were preserved.');
                }
            }
        }
        // Preserve all original segment order; append only newly mapped ZCD rows.
        var a31Output = [];
        for (ar = 0; ar < a31Rows.length; ar++) { a31Output.push(a31Rows[ar].join('|')); }
        for (ar = 0; ar < a31NewZcd.length; ar++) { a31Output.push(a31NewZcd[ar].join('|')); }
        warnings.push('A31 preservation mode: source facility retained; external facility lookup not applied.');
        return {
            hl7: a31Output.join('\r') + '\r', site: site, event: sourceEvent,
            warnings: warnings, defaultedFields: []
        };
    }

    var facilityCode = site;
    if (options.facilityResolver) {
        var facility = options.facilityResolver(site, ids.MR.substring(0, 2));
        if (!facility || !facility.FacilityID) { throw new Error('Facility lookup did not return a FacilityID.'); }
        facilityCode = String(facility.FacilityID);
    } else {
        warnings.push('Facility lookup unavailable; input site used as output facility.');
    }
    var output = [];
    var messageDate = segments.EVN ? v('EVN', 2) : v('MSH', 7);
    var msh = ['MSH', '^~\\&', v('MSH', 3), site + '^' + c(f('MSH', 4), 2), '', v('MSH', 6),
        dateValue(messageDate, false, 'MSH-7', true), '', 'ADT^A08', v('MSH', 10), v('MSH', 11),
        '2.4', '1', '', 'AL', 'NE', 'AU', 'ASCII', 'ENG^English'];
    output.push(emit(msh));
    var evn = seg('EVN', 6);
    evn[2] = dateValue(messageDate, false, 'EVN-2', true);
    evn[6] = ts('EVN', 6, 'EVN-6', true);
    output.push(emit(evn));
    var mobile = '', custom = [];
    var obxs = segments.OBX || [];
    var zqdss = segments.ZQDS || [];
    if (sourceEvent === 'A08') {
        for (i = 0; i < obxs.length; i++) {
            var key = v('OBX', 3, 1, i);
            var code = sub(c(repeat(f('OBX', 5, i)), 1), 1);
            var text = sub(c(repeat(f('OBX', 5, i)), 2), 1);
            custom.push({key: key, code: code, text: text});
            if (key === 'ZADPTOTHPH' && text !== '') { mobile = text; }
        }
    } else {
        for (i = 0; i < zqdss.length; i++) {
            for (var j = 1; j < zqdss[i].length; j++) {
                var pair = String(zqdss[i][j] || '').split('~');
                custom.push({key: sub(c(pair[0], 1), 1), code: sub(c(pair[1], 1), 1), text: sub(c(pair[1], 1), 1)});
            }
            // Match the supplied Lua exactly: first repetition of fields 1 and 2.
            if (sub(c(repeat(f('ZQDS', 1, i), 0), 1), 1) === 'ZADPTOTHPH') {
                mobile = sub(c(repeat(f('ZQDS', 2, i), 0), 1), 1);
                warnings.push('A31 mobile value read from ZQDS-2 repetition 1, matching the supplied Lua helper.');
            }
        }
    }
    var pid = seg('PID', 19), outIds = [];
    var types = ['MR', 'SS', 'DVA', 'PEN', 'SFN', 'PI'];
    for (i = 0; i < types.length; i++) {
        // PID-19 overwrites the Medicare object value in the supplied Lua.
        var idValue = types[i] === 'SS' ? f('PID', 19) : (ids[types[i]] || '');
        outIds.push(idValue + '^^^^' + types[i] + '^' + facilityCode);
    }
    pid[1] = '1'; pid[3] = outIds.join('~'); pid[4] = v('PID', 4);
    pid[5] = pad([v('PID', 5, 1), v('PID', 5, 2), v('PID', 5, 3), '', v('PID', 5, 5), '', v('PID', 5, 7)], 7, '^') + '~~';
    pid[6] = v('PID', 6);
    pid[7] = dateValue(v('PID', 7), true, 'PID-7', true);
    pid[8] = f('PID', 8);
    pid[10] = v('PID', 10);
    var addr = repeat(f('PID', 11));
    pid[11] = pad([sub(c(addr, 1), 1), '', c(addr, 3), c(addr, 4), c(addr, 5)], 5, '^');
    if (sub(c(addr, 1), 2) || sub(c(addr, 1), 3)) {
        warnings.push('Additional PID-11.1 subcomponents discarded, matching Charm address customisation.');
    }
    pid[13] = v('PID', 13); pid[14] = mobile + '^^^^^^';
    pid[15] = v('PID', 15); pid[16] = v('PID', 16); pid[17] = v('PID', 17);
    pid[18] = v('PID', 18); pid[19] = f('PID', 19);
    if (f('PID', 29) !== '' || f('PID', 30) !== '') {
        while (pid.length <= 30) { pid.push(''); }
        pid[29] = f('PID', 29) === '' ? '' : ts('PID', 29, 'PID-29', false);
        pid[30] = f('PID', 30) || (f('PID', 29) !== '' ? 'Y' : '');
    }
    output.push(emit(pid));
    var nk1 = seg('NK1', 7);
    for (i = 1; i <= 6; i++) { nk1[i] = f('NK1', i); }
    var nkAddr = f('NK1', 4).split('~');
    var firstAddress = pad((nkAddr[0] || '').split('^'), Math.max(7, (nkAddr[0] || '').split('^').length), '^').split('^');
    firstAddress[6] = 'H'; nkAddr[0] = firstAddress.join('^');
    nk1[4] = nkAddr.join('~'); nk1[7] = v('NK1', 7);
    output.push(emit(nk1));
    function doctor(fieldNo, attending) {
        var source = repeat(f('PV1', fieldNo));
        var len = attending ? 16 : 9;
        var parts = [];
        for (var q = 0; q < len; q++) { parts.push(''); }
        var positions = attending ? [1, 2, 3, 6, 9, 13, 16] : [1, 2, 3, 6, 9];
        for (var d = 0; d < positions.length; d++) {
            parts[positions[d] - 1] = sub(c(source, positions[d]), 1);
        }
        return parts.join('^') + new Array(len).join('~');
    }
    var pv1 = seg('PV1', 47);
    pv1[1] = '1'; copyScalar(pv1, 'PV1', [2,4,10,13,14,18,19,20,36,41,47]);
    pv1[3] = pad([v('PV1',3,1),v('PV1',3,2),v('PV1',3,3)],3,'^');
    pv1[6] = pad([v('PV1',6,1),v('PV1',6,2),v('PV1',6,3)],3,'^');
    pv1[7] = doctor(7,true); pv1[8] = doctor(8,false); pv1[9] = doctor(9,false); pv1[17] = doctor(17,false);
    pv1[39] = facilityCode;
    pv1[44] = ts('PV1',44,'PV1-44',true); pv1[45] = ts('PV1',45,'PV1-45',true);
    output.push(emit(pv1));
    var gt = seg('GT1',12);
    gt[3] = v('GT1',3,1) + '^' + v('GT1',3,2);
    var gtAddr = repeat(f('GT1',5));
    gt[5] = pad([sub(c(gtAddr,1),1) + '&' + sub(c(gtAddr,1),2), '', c(gtAddr,3), c(gtAddr,4), c(gtAddr,5)],5,'^');
    gt[6] = v('GT1',6); gt[7] = v('GT1',7); gt[11] = v('GT1',11); gt[12] = f('GT1',12);
    output.push(emit(gt));
    var ins = seg('IN1',45);
    ins[2] = v('IN1',2); ins[3] = repeat(f('IN1',3)); ins[4] = v('IN1',4);
    var insAddr = repeat(f('IN1',5));
    ins[5] = pad([sub(c(insAddr,1),1),c(insAddr,2),c(insAddr,3),c(insAddr,4),c(insAddr,5)],5,'^');
    ins[7] = v('IN1',7);
    ins[29] = dateValue(v('IN1',29),true,'IN1-29',true);
    ins[30] = v('IN1',30); ins[35] = f('IN1',35); ins[36] = f('IN1',36); ins[45] = f('IN1',45);
    output.push(emit(ins));
    var allowed = 'ZADPTTITLE ADPTMCEXP ADPTPENSTA ADPTPENS ADPTDVACAR ADPTDVANUM ZADPTWORKP ADPTSNET'.split(' ');
    var coded = ['ZADPTTITLE','ADPTPENSTA','ADPTDVACAR'];
    var zcdCount = 0;
    for (i = 0; i < custom.length; i++) {
        var row = custom[i];
        if (allowed.indexOf(row.key) < 0 || (sourceEvent === 'A08' && row.text === '')) { continue; }
        var value = sourceEvent === 'A08' && coded.indexOf(row.key) >= 0 ? row.code : row.text;
        output.push(emit(['ZCD',String(++zcdCount),row.key,value]));
    }
    if (defaults.length) {
        warnings.push('Legacy processing-time defaults applied to: ' + defaults.join(', ') + '. These are not source clinical event times.');
    }
    if ((segments.GT1 || []).length > 1 || (segments.IN1 || []).length > 1) {
        warnings.push('Only the first GT1 and IN1 are mapped, matching the supplied output grammar.');
    }
    return {hl7:output.join('\r') + '\r', site:site, event:sourceEvent, warnings:warnings, defaultedFields:defaults};
}
