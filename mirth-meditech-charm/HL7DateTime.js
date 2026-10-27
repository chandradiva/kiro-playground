/**
 * Library: HL7 Datetime Utilities
 * Code Template: HL7DateTime
 *
 * Validation and normalization of HL7 timestamps. Stateless: the
 * original closures `validClock`, `dateValue` and `ts` captured
 * `processingTimestamp`, `options`, `warnings`, and `defaults`. Those
 * are now passed in explicitly so these can be shared across channels.
 */

/** True when `stamp` is exactly 14 digits (YYYYMMDDHHMMSS). */
function HL7_validClock(stamp) {
    return /^\d{14}$/.test(String(stamp || ''));
}

/**
 * Validate and normalize an HL7 timestamp value.
 *
 * @param {string} value               the raw timestamp
 * @param {boolean} dateOnly           return only the YYYYMMDD portion
 * @param {string} label               field label used in error/warning text
 * @param {boolean} allowCurrentDefault whether a legacy "now" default may apply
 * @param {object} ctx                 { processingTimestamp, options, warnings, defaults }
 *                                      - processingTimestamp: 14-digit string
 *                                      - options.legacyEmptyDateDefaults: boolean
 *                                      - warnings: array to collect warnings (mutated)
 *                                      - defaults: array to collect defaulted labels (mutated)
 * @returns {string} normalized timestamp, '' or '""'
 */
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
