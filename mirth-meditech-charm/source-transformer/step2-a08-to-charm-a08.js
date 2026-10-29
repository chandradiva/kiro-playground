/**
 * SOURCE TRANSFORMER - STEP 2 (JavaScript): Meditech A08 -> Charm A08
 *
 * Runs only when the incoming event is A08. Requires Step 1.
 */

function a08ResolveFacility(ctx, meta) {
    var options = ctx.options;
    if (options.facilityResolver) {
        var facility = options.facilityResolver(meta.site, meta.ids.MR.substring(0, 2));
        if (!facility || !facility.FacilityID) { throw new Error('Facility lookup did not return a FacilityID.'); }
        return String(facility.FacilityID);
    }
    ctx.warnings.push('Facility lookup unavailable; input site used as output facility.');
    return meta.site;
}

/* Gather OBX custom key/code/text pairs and the mobile number. */
function a08CollectCustom(ctx) {
    var f = ctx.f, v = ctx.v, c = ctx.c, sub = ctx.sub, repeat = ctx.repeat;
    var mobile = '', custom = [];
    var obxs = ctx.segments.OBX || [];
    for (var i = 0; i < obxs.length; i++) {
        var key = v('OBX', 3, 1, i);
        var code = sub(c(repeat(f('OBX', 5, i)), 1), 1);
        var text = sub(c(repeat(f('OBX', 5, i)), 2), 1);
        custom.push({ key: key, code: code, text: text });
        if (key === 'ZADPTOTHPH' && text !== '') { mobile = text; }
    }
    return { mobile: mobile, custom: custom };
}

function a08BuildMsh(ctx, meta) {
    var v = ctx.v, c = ctx.c, f = ctx.f;
    var messageDate = ctx.segments.EVN ? v('EVN', 2) : v('MSH', 7);
    var msh = ['MSH', '^~\\&', v('MSH', 3), meta.site + '^' + c(f('MSH', 4), 2), '', v('MSH', 6),
        ctx.dateValue(messageDate, false, 'MSH-7', true), '', 'ADT^A08', v('MSH', 10), v('MSH', 11),
        '2.4', '1', '', 'AL', 'NE', 'AU', 'ASCII', 'ENG^English'];
    return ctx.emit(msh);
}

function a08BuildEvn(ctx) {
    var v = ctx.v;
    var messageDate = ctx.segments.EVN ? v('EVN', 2) : v('MSH', 7);
    var evn = ctx.seg('EVN', 6);
    evn[2] = ctx.dateValue(messageDate, false, 'EVN-2', true);
    evn[6] = ctx.ts('EVN', 6, 'EVN-6', true);
    return ctx.emit(evn);
}

function a08BuildPid(ctx, meta, facilityCode, mobile) {
    var f = ctx.f, v = ctx.v, c = ctx.c, sub = ctx.sub, repeat = ctx.repeat, pad = ctx.pad;
    var pid = ctx.seg('PID', 19), outIds = [];
    var types = ['MR', 'SS', 'DVA', 'PEN', 'SFN', 'PI'];
    for (var i = 0; i < types.length; i++) {
        // PID-19 overwrites the Medicare object value in the supplied Lua.
        var idValue = types[i] === 'SS' ? f('PID', 19) : (meta.ids[types[i]] || '');
        outIds.push(idValue + '^^^^' + types[i] + '^' + facilityCode);
    }
    pid[1] = '1'; pid[3] = outIds.join('~'); pid[4] = v('PID', 4);
    pid[5] = pad([v('PID', 5, 1), v('PID', 5, 2), v('PID', 5, 3), '', v('PID', 5, 5), '', v('PID', 5, 7)], 7, '^') + '~~';
    pid[6] = v('PID', 6);
    pid[7] = ctx.dateValue(v('PID', 7), true, 'PID-7', true);
    pid[8] = f('PID', 8);
    pid[10] = v('PID', 10);
    var addr = repeat(f('PID', 11));
    pid[11] = pad([sub(c(addr, 1), 1), '', c(addr, 3), c(addr, 4), c(addr, 5)], 5, '^');
    if (sub(c(addr, 1), 2) || sub(c(addr, 1), 3)) {
        ctx.warnings.push('Additional PID-11.1 subcomponents discarded, matching Charm address customisation.');
    }
    pid[13] = v('PID', 13); pid[14] = mobile + '^^^^^^';
    pid[15] = v('PID', 15); pid[16] = v('PID', 16); pid[17] = v('PID', 17);
    pid[18] = v('PID', 18); pid[19] = f('PID', 19);
    if (f('PID', 29) !== '' || f('PID', 30) !== '') {
        while (pid.length <= 30) { pid.push(''); }
        pid[29] = f('PID', 29) === '' ? '' : ctx.ts('PID', 29, 'PID-29', false);
        pid[30] = f('PID', 30) || (f('PID', 29) !== '' ? 'Y' : '');
    }
    return ctx.emit(pid);
}

function a08BuildNk1(ctx) {
    var f = ctx.f, v = ctx.v, pad = ctx.pad;
    var nk1 = ctx.seg('NK1', 7);
    for (var i = 1; i <= 6; i++) { nk1[i] = f('NK1', i); }
    var nkAddr = f('NK1', 4).split('~');
    var firstAddress = pad((nkAddr[0] || '').split('^'), Math.max(7, (nkAddr[0] || '').split('^').length), '^').split('^');
    firstAddress[6] = 'H'; nkAddr[0] = firstAddress.join('^');
    nk1[4] = nkAddr.join('~'); nk1[7] = v('NK1', 7);
    return ctx.emit(nk1);
}

function a08BuildPv1(ctx, facilityCode) {
    var v = ctx.v, c = ctx.c, sub = ctx.sub, repeat = ctx.repeat, f = ctx.f, pad = ctx.pad;
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
    var pv1 = ctx.seg('PV1', 47);
    pv1[1] = '1'; ctx.copyScalar(pv1, 'PV1', [2, 4, 10, 13, 14, 18, 19, 20, 36, 41, 47]);
    pv1[3] = pad([v('PV1', 3, 1), v('PV1', 3, 2), v('PV1', 3, 3)], 3, '^');
    pv1[6] = pad([v('PV1', 6, 1), v('PV1', 6, 2), v('PV1', 6, 3)], 3, '^');
    pv1[7] = doctor(7, true); pv1[8] = doctor(8, false); pv1[9] = doctor(9, false); pv1[17] = doctor(17, false);
    pv1[39] = facilityCode;
    pv1[44] = ctx.ts('PV1', 44, 'PV1-44', true); pv1[45] = ctx.ts('PV1', 45, 'PV1-45', true);
    return ctx.emit(pv1);
}

function a08BuildGt1(ctx) {
    var v = ctx.v, c = ctx.c, sub = ctx.sub, repeat = ctx.repeat, f = ctx.f, pad = ctx.pad;
    var gt = ctx.seg('GT1', 12);
    gt[3] = v('GT1', 3, 1) + '^' + v('GT1', 3, 2);
    var gtAddr = repeat(f('GT1', 5));
    gt[5] = pad([sub(c(gtAddr, 1), 1) + '&' + sub(c(gtAddr, 1), 2), '', c(gtAddr, 3), c(gtAddr, 4), c(gtAddr, 5)], 5, '^');
    gt[6] = v('GT1', 6); gt[7] = v('GT1', 7); gt[11] = v('GT1', 11); gt[12] = f('GT1', 12);
    return ctx.emit(gt);
}

function a08BuildIn1(ctx) {
    var v = ctx.v, c = ctx.c, sub = ctx.sub, repeat = ctx.repeat, f = ctx.f, pad = ctx.pad;
    var ins = ctx.seg('IN1', 45);
    ins[2] = v('IN1', 2); ins[3] = repeat(f('IN1', 3)); ins[4] = v('IN1', 4);
    var insAddr = repeat(f('IN1', 5));
    ins[5] = pad([sub(c(insAddr, 1), 1), c(insAddr, 2), c(insAddr, 3), c(insAddr, 4), c(insAddr, 5)], 5, '^');
    ins[7] = v('IN1', 7);
    ins[29] = ctx.dateValue(v('IN1', 29), true, 'IN1-29', true);
    ins[30] = v('IN1', 30); ins[35] = f('IN1', 35); ins[36] = f('IN1', 36); ins[45] = f('IN1', 45);
    return ctx.emit(ins);
}

/* Append mapped ZCD rows to the output array. */
function a08BuildZcd(ctx, custom, output) {
    var allowed = 'ZADPTTITLE ADPTMCEXP ADPTPENSTA ADPTPENS ADPTDVACAR ADPTDVANUM ZADPTWORKP ADPTSNET'.split(' ');
    var coded = ['ZADPTTITLE', 'ADPTPENSTA', 'ADPTDVACAR'];
    var zcdCount = 0;
    for (var i = 0; i < custom.length; i++) {
        var row = custom[i];
        if (allowed.indexOf(row.key) < 0 || row.text === '') { continue; }
        var value = coded.indexOf(row.key) >= 0 ? row.code : row.text;
        output.push(ctx.emit(['ZCD', String(++zcdCount), row.key, value]));
    }
}

function convertMeditechA08ToCharm(ctx, meta) {
    var facilityCode = a08ResolveFacility(ctx, meta);
    var collected = a08CollectCustom(ctx);

    var output = [];
    output.push(a08BuildMsh(ctx, meta));
    output.push(a08BuildEvn(ctx));
    output.push(a08BuildPid(ctx, meta, facilityCode, collected.mobile));
    output.push(a08BuildNk1(ctx));
    output.push(a08BuildPv1(ctx, facilityCode));
    output.push(a08BuildGt1(ctx));
    output.push(a08BuildIn1(ctx));
    a08BuildZcd(ctx, collected.custom, output);

    if (ctx.defaults.length) {
        ctx.warnings.push('Legacy processing-time defaults applied to: ' + ctx.defaults.join(', ') + '. These are not source clinical event times.');
    }
    if ((ctx.segments.GT1 || []).length > 1 || (ctx.segments.IN1 || []).length > 1) {
        ctx.warnings.push('Only the first GT1 and IN1 are mapped, matching the supplied output grammar.');
    }
    return {
        hl7: output.join('\r') + '\r', site: meta.site, event: meta.sourceEvent,
        warnings: ctx.warnings, defaultedFields: ctx.defaults
    };
}

/* ===================== Run (A08 only) ===================== */
if (charmMeta.sourceEvent === 'A08') {
    charmResult = convertMeditechA08ToCharm(charmCtx, charmMeta);
    tmp = charmOutput(charmResult);
}
