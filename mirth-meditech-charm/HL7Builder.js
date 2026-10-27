/**
 * Library: HL7 Build Utilities
 * Code Template: HL7Builder
 *
 * Pure helpers for constructing output HL7 segments. These were already
 * stateless in the original code; they are moved here verbatim (names
 * namespaced) so they can be reused across channels.
 */

/**
 * Take up to `length` values, pad with empty strings to exactly
 * `length`, and join with `separator`.
 */
function HL7_pad(values, length, separator) {
    var a = values.slice(0, length);
    while (a.length < length) { a.push(''); }
    return a.join(separator);
}

/**
 * Create a new segment array starting with `tag`, padded so that
 * index `count` exists (i.e. field `count` is addressable).
 */
function HL7_seg(tag, count) {
    var a = [tag];
    while (a.length <= count) { a.push(''); }
    return a;
}

/** Serialize a segment array to an HL7 line (pipe-delimited, trailing pipe). */
function HL7_emit(a) { return a.join('|') + '|'; }
