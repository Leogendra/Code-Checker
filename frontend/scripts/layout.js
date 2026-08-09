/* ---------- DOM construction ---------- */

function createCell(fid, spec) {
    const len = spec ? spec.length : 2;
    const type = spec ? spec.type : "digits";

    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.field = String(fid);
    cell.style.setProperty("--field-length", String(len));

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = type === "digits" ? "numeric" : "text";
    input.maxLength = len;
    input.autocomplete = "off";
    input.dataset.field = String(fid);
    input.addEventListener("input", onInput);
    input.addEventListener("keydown", onKey);

    const fx = document.createElement("span");
    fx.className = "lock-fx";
    fx.setAttribute("aria-hidden", "true");
    fx.innerHTML =
        '<span class="dial"></span>' +
        '<span class="ring ring-inner"></span>' +
        '<span class="ring ring-outer"></span>';

    cell.appendChild(input);
    cell.appendChild(fx);
    bindGroupHint(cell);
    return cell;
}

function buildLayout(layout, specs) {
    els.code.innerHTML = "";

    layout.forEach((partItems, pi) => {
        const partEl = document.createElement("div");
        partEl.className = "part";
        partEl.dataset.part = String(pi);

        partItems.forEach((item) => {
            if (typeof item === "string") {
                const dotEl = document.createElement("span");
                dotEl.className = "dot";
                dotEl.textContent = item;
                partEl.appendChild(dotEl);
            } else {
                partEl.appendChild(createCell(item, specs[item]));
            }
        });

        els.code.appendChild(partEl);
    });

    els.groupTip = document.createElement("div");
    els.groupTip.className = "group-tip";
    els.groupTip.setAttribute("role", "tooltip");
    document.querySelector(".code-wrap").appendChild(els.groupTip);

    applyGroups(groups);
}

function applyGroups(serverGroups) {
    // The server sends already-normalized groups (fields = source of truth,
    // singletons added for missing ones, invalid indices filtered out).
    groups = (serverGroups || []).map((ids) => ids.slice().sort((a, b) => a - b));
    groupOf = {};
    groups.forEach((ids, gi) => ids.forEach((fid) => { groupOf[fid] = gi; }));

    groups.forEach((ids, gi) => ids.forEach((fid) => {
        const cell = cellOf(fid);
        if (cell) cell.dataset.group = String(gi);
    }));
}

/* ---------- Group hint ---------- */

let hintTimer = null;
let hintedGroup = null;

function isGroupRevealed(gi) {
    return (groups[gi] || []).every((fid) => state.fields[fid]?.solved);
}

function showGroupHint(fid) {
    const gi = groupOf[fid];
    if (gi === undefined || gi === hintedGroup) return;
    const ids = groups[gi] || [];
    // A "lone" group no longer shows any visual indicator (no border, no tooltip).
    if (ids.length <= 1) return;
    if (isGroupRevealed(gi)) return;
    hideGroupHint();
    hintedGroup = gi;

    const cells = ids.map(cellOf).filter(Boolean);
    if (!cells.length) return;
    cells.forEach((c) => c.classList.add("group-hl"));

    els.groupTip.textContent = t("group_reveal_together", { count: ids.length });

    const wrap = document.querySelector(".code-wrap").getBoundingClientRect();
    const rects = cells.map((c) => c.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const center = (left + right) / 2 - wrap.left;

    els.groupTip.classList.add("visible");
    const half = els.groupTip.offsetWidth / 2;
    els.groupTip.style.left = `${Math.min(Math.max(center, half), wrap.width - half)}px`;
}

function hideGroupHint() {
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
    if (hintedGroup === null) return;
    hintedGroup = null;
    document.querySelectorAll(".cell.group-hl").forEach((c) => c.classList.remove("group-hl"));
    els.groupTip.classList.remove("visible");
}

function bindGroupHint(cell) {
    const fid = Number(cell.dataset.field);

    cell.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "mouse") showGroupHint(fid);
    });
    cell.addEventListener("pointerdown", (e) => {
        if (e.pointerType === "mouse") return;
        hintTimer = setTimeout(() => {
            hintTimer = null;
            showGroupHint(fid);
        }, LONG_PRESS_MS);
    });

    cell.addEventListener("pointerleave", hideGroupHint);
    cell.addEventListener("pointercancel", hideGroupHint);
    cell.addEventListener("pointerup", (e) => {
        if (e.pointerType !== "mouse") hideGroupHint();
    });
    cell.addEventListener("contextmenu", (e) => {
        if (hintedGroup !== null) e.preventDefault();
    });
}
