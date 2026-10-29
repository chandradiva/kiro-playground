/**
 * SOURCE TRANSFORMER - STEP 3 (JavaScript): Meditech A31 -> Charm A08
 *
 * Runs only when the incoming event is A31. Requires Step 1.
 * Preservation mode: keeps the source segments in order, rewrites the
 * header/event to A08, normalizes dates, and appends mapped ZCD rows.
 */

function convertMeditechA31ToCharm(ctx, meta) {
    var segments = ctx.segments, lines = ctx.lines, sub = ctx.sub, c = ctx.c;
    var site = meta.site, sourceEvent = meta.sourceEvent, warnings = ctx.warnings;

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
        parts[0] = ctx.dateValue(parts[0], false, row[0] + '-' + number, false);
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

/* ===================== Run (A31 only) ===================== */
if (charmMeta !== null && charmMeta.sourceEvent === 'A31') {
    charmResult = convertMeditechA31ToCharm(charmCtx, charmMeta);
    tmp = charmOutput(charmResult);
}
