/* ---------- Animations ---------- */

let fxTimers = [];
let fxRunningUntil = 0;

function fxBusy() {
    return Date.now() < fxRunningUntil;
}

function clearFx() {
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
    fxRunningUntil = 0;
    document.querySelectorAll(".cell").forEach((cell) => {
        cell.classList.remove("unlocking", "shaking");
        delete cell.dataset.fx;
    });
}

function computeFxSteps(data, submittedIds) {
    const results = data.results || {};
    const byGroup = new Map();

    submittedIds.forEach((fid) => {
        const res = results[fid] ?? results[String(fid)];
        if (!res || res.skipped) return;
        const kind = res.correct && !res.pending ? "success" : data.global_locked ? "fail" : null;
        if (!kind) return;
        const gi = groupOf[fid];
        if (gi === undefined) return;
        if (!byGroup.has(gi)) byGroup.set(gi, { gi, kind, fids: new Set() });
        byGroup.get(gi).fids.add(fid);
    });

    byGroup.forEach((step) => {
        if (step.kind === "success") (groups[step.gi] || []).forEach((fid) => step.fids.add(fid));
    });

    return [...byGroup.values()]
        .map((step) => ({ ...step, fids: [...step.fids].sort((a, b) => a - b) }))
        .sort((a, b) => a.fids[0] - b.fids[0]);
}

function fxTotalMs(steps) {
    if (!steps.length) return 0;
    const last = steps[steps.length - 1];
    return (steps.length - 1) * FX_STAGGER_MS +
        (last.kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS);
}

function markFxPending(steps) {
    clearFx();
    fxRunningUntil = Date.now() + fxTotalMs(steps);
    steps.forEach(({ fids }) => fids.forEach((fid) => {
        const cell = cellOf(fid);
        if (cell) cell.dataset.fx = "pending";
    }));
}

function runFxSequence(steps) {
    if (!steps.length) return;
    fxRunningUntil = Date.now() + fxTotalMs(steps);

    steps.forEach(({ fids, kind }, i) => {
        const start = setTimeout(() => {
            const cells = fids.map(cellOf).filter(Boolean);
            if (!cells.length) return;
            cells.forEach((cell) => {
                delete cell.dataset.fx;
                cell.classList.add(kind === "success" ? "unlocking" : "shaking");
            });
            const end = setTimeout(() => {
                cells.forEach((cell) => cell.classList.remove("unlocking", "shaking"));
            }, (kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS) + 60);
            fxTimers.push(end);
        }, i * FX_STAGGER_MS);
        fxTimers.push(start);
    });

    fxTimers.push(setTimeout(render, Math.max(0, fxRunningUntil - Date.now()) + 80));
}
