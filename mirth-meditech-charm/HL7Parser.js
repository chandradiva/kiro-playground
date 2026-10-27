/**
 * Library: HL7 Parsing Utilities
 * Code Template: HL7Parser
 *
 * Low-level helpers for normalizing a raw HL7 message and reading
 * fields / components / subcomponents / repetitions.
 *
 * These functions are STATELESS. Instead of capturing a `segments`
 * closure, the accessors take an explicit `segments` map (as produced
 * by HL7_parse) so they can live in a shared Mirth code template.
 */

/**
 * Normalize line endings and strip a leading BOM. Also validates that
 * the message uses the standard encoding characters.
 *
 * @param {string} raw
 * @returns {string} normalized message with \r separators
 */
function HL7_normalize(raw) {
    raw = String(raw).replace(/^\uFEFF/, '').replace(/\r\n/g, '\r').replace(/\n/g, '\r');
    if (raw.substring(0, 8) !== 'MSH|^~\\&') {
        throw new Error('Unsupported HL7 delimiters; expected MSH|^~\\&.');
    }
    return raw;
}

/**
 * Parse a normalized HL7 message into a segment map and an ordered
 * list of segment tags.
 *
 * Returns an object: { segments: {TAG: [tokens...][]}, order: [TAG...], lines: [string...] }
 *
 * @param {string} raw normalized message (use HL7_normalize first)
 */
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

/**
 * Read a raw field value from a parsed segment map.
 * MSH is handled specially (field numbers are offset by one because
 * the field separator occupies position 1).
 *
 * @param {object} segments segment map from HL7_parse
 * @param {string} tag segment tag, e.g. 'PID'
 * @param {number} n field number
 * @param {number} [r] repetition (segment occurrence) index, default 0
 */
function HL7_field(segments, tag, n, r) {
    var list = segments[tag], row = list && list[r || 0];
    return row ? (row[tag === 'MSH' ? n - 1 : n] || '') : '';
}

/** Return the r-th repetition (~-delimited) of a value. */
function HL7_repeat(value, r) { return String(value || '').split('~')[r || 0] || ''; }

/** Return the n-th component (^-delimited, 1-based) of a value. */
function HL7_component(value, n) { return String(value || '').split('^')[n - 1] || ''; }

/** Return the n-th subcomponent (&-delimited, 1-based) of a value. */
function HL7_subcomponent(value, n) { return String(value || '').split('&')[n - 1] || ''; }

/**
 * Convenience accessor: first subcomponent of the n-th component of the
 * r-th repetition of field `n` in segment `tag`.
 * Equivalent to the original closure `v(tag, n, component, r)`.
 */
function HL7_value(segments, tag, n, component, r) {
    return HL7_subcomponent(HL7_component(HL7_repeat(HL7_field(segments, tag, n, r)), component || 1), 1);
}
