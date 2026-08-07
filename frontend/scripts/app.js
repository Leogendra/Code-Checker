// field_specs et layout chargés depuis /api/state au premier appel
let fieldSpecs = [];  // [{ id, length, alphabet }]
let layoutData = null;
let layoutBuilt = false;

// Groupes logiques (règle de révélation), fournis par GET /api/state.
let groups = [];
let groupOf = {};

const LONG_PRESS_MS = 350;

// Animations : durées alignées sur les keyframes de style.css
const FX_STAGGER_MS = 1500;
const FX_SUCCESS_MS = 1800;
const FX_FAIL_MS = 520;

const state = {
    fields: [],  // peuplé après le premier loadState
    all_solved: false,
    global_locked_until: null,
    message: null,
};

const els = {
    coords: document.getElementById("coords"),
    status: document.getElementById("status"),
    submitBtn: document.getElementById("submit-btn"),
    submitRow: document.getElementById("submit-row"),
    final: document.getElementById("final"),
    globalLock: document.getElementById("global-lock"),
};

/* ---------- Filtrage par alphabet ---------- */

function filterByAlphabet(val, alphabet) {
    if (alphabet === "digits") return val.replace(/\D/g, "");
    if (alphabet === "hex")   return val.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
    if (alphabet === "upper") return val.replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (alphabet === "alnum") return val.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
    return val; // "any"
}

function isValidSubmitValue(v, spec) {
    if (!spec) return /^\d{1,2}$/.test(v);
    const { length, alphabet } = spec;
    if (alphabet === "digits") return /^\d+$/.test(v) && v.length >= 1 && v.length <= length;
    return v.length === length && filterByAlphabet(v, alphabet) === v;
}

/* ---------- Construction du DOM ---------- */

function createCell(fid, spec) {
    const len = spec ? spec.length : 2;
    const alphabet = spec ? spec.alphabet : "digits";

    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.field = String(fid);
    cell.style.setProperty("--field-length", String(len));

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = alphabet === "digits" ? "numeric" : "text";
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
    els.coords.innerHTML = "";
    const sep = layout.separator || "";

    layout.parts.forEach((partIds, pi) => {
        // Séparateur inter-partie
        if (pi > 0 && sep) {
            const dotEl = document.createElement("span");
            dotEl.className = "dot";
            dotEl.textContent = sep;
            els.coords.appendChild(dotEl);
        }

        const partEl = document.createElement("div");
        partEl.className = "part";
        partEl.dataset.part = String(pi);

        partIds.forEach((fid) => {
            partEl.appendChild(createCell(fid, specs[fid]));
        });

        els.coords.appendChild(partEl);
    });

    els.groupTip = document.createElement("div");
    els.groupTip.className = "group-tip";
    els.groupTip.setAttribute("role", "tooltip");
    document.querySelector(".coords-wrap").appendChild(els.groupTip);

    applyGroups(groups);
}

/**
 * Adopte le découpage en groupes envoyé par le serveur.
 */
function applyGroups(serverGroups) {
    const total = fieldSpecs.length;
    const valid =
        total > 0 &&
        Array.isArray(serverGroups) &&
        serverGroups.length > 0 &&
        serverGroups.every((ids) => Array.isArray(ids) && ids.length > 0 &&
            ids.every((fid) => Number.isInteger(fid) && fid >= 0 && fid < total)) &&
        serverGroups.flat().slice().sort((a, b) => a - b).join(",") ===
            Array.from({ length: total }, (_, i) => i).join(",");

    groups = valid ? serverGroups.map((ids) => ids.slice().sort((a, b) => a - b))
                   : Array.from({ length: total }, (_, i) => [i]);
    groupOf = {};
    groups.forEach((ids, gi) => ids.forEach((fid) => { groupOf[fid] = gi; }));

    groups.forEach((ids, gi) => ids.forEach((fid) => {
        const cell = cellOf(fid);
        if (cell) cell.dataset.group = String(gi);
    }));
}

/* ---------- Saisie ---------- */

function onInput(e) {
    const el = e.target;
    hideGroupHint();
    const fid = Number(el.dataset.field);
    const spec = fieldSpecs[fid];
    const len = spec ? spec.length : 2;
    const alphabet = spec ? spec.alphabet : "digits";
    el.value = filterByAlphabet(el.value, alphabet).slice(0, len);
    if (state.fields[fid]) state.fields[fid].value = el.value;
    if (el.value.length === len) {
        const next = findNextEditable(fid);
        if (next) next.focus();
    }
}

function onKey(e) {
    if (e.key === "Enter") {
        e.preventDefault();
        submitAll();
    } else if (e.key === "Backspace" && !e.target.value) {
        const prev = findPrevEditable(Number(e.target.dataset.field));
        if (prev) prev.focus();
    }
}

function findNextEditable(fromId) {
    for (let i = fromId + 1; i < fieldSpecs.length; i++) {
        if (isEditable(i)) return document.querySelector(`input[data-field="${i}"]`);
    }
    return null;
}

function findPrevEditable(fromId) {
    for (let i = fromId - 1; i >= 0; i--) {
        if (isEditable(i)) return document.querySelector(`input[data-field="${i}"]`);
    }
    return null;
}

function isEditable(fid) {
    return !state.fields[fid]?.solved && !isAdminLocked(fid) && !isGlobalLocked();
}

function isAdminLocked(fid) {
    const lu = state.fields[fid]?.locked_until;
    if (!lu) return false;
    return new Date(lu).getTime() > Date.now();
}

function isGlobalLocked() {
    return !!(state.global_locked_until && new Date(state.global_locked_until).getTime() > Date.now());
}

function stripZeroPad(v) {
    if (!v) return "";
    return String(Number(v));
}

function cellOf(fid) {
    return document.querySelector(`.cell[data-field="${fid}"]`);
}

/* ---------- Indicateur de groupe ---------- */

let hintTimer = null;
let hintedGroup = null;

function isGroupRevealed(gi) {
    return (groups[gi] || []).every((fid) => state.fields[fid]?.solved);
}

function showGroupHint(fid) {
    const gi = groupOf[fid];
    if (gi === undefined || gi === hintedGroup) return;
    if (isGroupRevealed(gi)) return;
    hideGroupHint();
    hintedGroup = gi;

    const ids = groups[gi];
    const cells = ids.map(cellOf).filter(Boolean);
    if (!cells.length) return;
    cells.forEach((c) => c.classList.add("group-hl"));

    els.groupTip.textContent =
        ids.length > 1
            ? `${ids.length} champs seront révélés ensemble`
            : "Ce champ sera révélé seul";

    const wrap = document.querySelector(".coords-wrap").getBoundingClientRect();
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

/* ---------- Soumission ---------- */

async function submitAll() {
    if (isGlobalLocked()) return;
    hideGroupHint();

    const payload = [];
    state.fields.forEach((f) => {
        if (f.solved || isAdminLocked(f.id)) return;
        const v = (f.value || "").trim();
        const spec = fieldSpecs[f.id];
        if (isValidSubmitValue(v, spec)) payload.push({ field_id: f.id, value: v });
    });
    if (payload.length === 0) {
        setStatus("Rien à valider : remplis au moins un champ.");
        return;
    }

    els.submitBtn.disabled = true;
    let steps = [];
    try {
        const r = await fetch("/api/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: payload }),
        });
        const data = await r.json();
        if (data.error) {
            setStatus("Erreur : " + data.error);
            return;
        }
        steps = computeFxSteps(data, payload.map((p) => p.field_id));
        markFxPending(steps);
        applyBatchResult(data);
        if (data.all_solved) state.all_solved = true;
    }
    catch (err) {
        setStatus("Erreur réseau.");
    }
    finally {
        render();
        runFxSequence(steps);
    }
}

function applyBatchResult(data) {
    let pendingCount = 0;
    Object.entries(data.results || {}).forEach(([fidStr, res]) => {
        const fid = Number(fidStr);
        if (res.correct && !res.pending) {
            state.fields[fid].solved = true;
            state.fields[fid].locked_until = null;
        } else if (res.pending) {
            pendingCount++;
        }
    });
    if (data.global_locked) state.global_locked_until = data.global_retry_at || null;
    if (pendingCount > 0 && !data.global_locked) {
        setStatus(`Tentative enregistrée, mais aucun groupe complet : rien à révéler.`);
    }
}

/* ---------- Zone #status ---------- */

const STATUS_TTL_MS = 6000;
let localStatus = "";
let localStatusUntil = 0;

function setStatus(msg) {
    localStatus = msg || "";
    localStatusUntil = msg ? Date.now() + STATUS_TTL_MS : 0;
    renderStatus();
}

function renderStatus() {
    let msg = "";
    if (localStatus && Date.now() < localStatusUntil) msg = localStatus;
    else if (state.message && !isGlobalLocked()) msg = state.message;

    els.status.style.display = msg ? "block" : "none";
    els.status.textContent = msg;
}

/* ---------- Chargement de l'état ---------- */

async function loadState() {
    try {
        const r = await fetch("/api/state");
        const data = await r.json();

        // Premier chargement : initialiser fieldSpecs, state.fields, et construire le DOM
        if (!layoutBuilt && data.field_specs && data.layout) {
            fieldSpecs = data.field_specs;
            state.fields = fieldSpecs.map((s) => ({
                id: s.id,
                solved: false,
                locked_until: null,
                value: "",
            }));
            applyGroups(data.groups);
            buildLayout(data.layout, fieldSpecs);
            layoutBuilt = true;
        } else {
            applyGroups(data.groups);
        }

        data.fields.forEach((f) => {
            const local = state.fields[f.id];
            if (!local) return;
            local.solved = f.solved;
            local.locked_until = f.locked_until;
            const spec = fieldSpecs[f.id];
            const isDigits = !spec || spec.alphabet === "digits";
            if (f.solved) local.value = isDigits ? (stripZeroPad(f.value) || local.value || "") : (f.value || local.value || "");
            else if (!local.value && f.value) local.value = isDigits ? stripZeroPad(f.value) : f.value;
        });

        state.all_solved = data.all_solved;
        state.global_locked_until = data.global_locked_until;
        state.message = data.message || null;
        render();
    } catch (e) {
        setStatus("Check ta connexion pelo.");
    }
}

/* ---------- Rendu ---------- */

function fmtCountdown(ms) {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h >= 24 * 365) return "∞";
    const pad = (n) => String(n).padStart(2, "0");
    if (h > 0) return `${pad(h)}:${pad(min)}:${pad(sec)}`;
    return `${pad(min)}:${pad(sec)}`;
}

function render() {
    if (state.fields.length === 0) return; // layout pas encore construit

    const gl = isGlobalLocked();

    if (hintedGroup !== null && isGroupRevealed(hintedGroup)) hideGroupHint();

    state.fields.forEach((f) => {
        const cell = document.querySelector(`.cell[data-field="${f.id}"]`);
        if (!cell) return;
        const input = cell.querySelector("input");
        cell.classList.remove("solved", "locked", "admin-locked");

        if (f.solved) {
            cell.classList.add("solved");
            input.value = f.value || "";
            input.readOnly = true;
            input.disabled = false;
        } else if (isAdminLocked(f.id)) {
            cell.classList.add("admin-locked");
            input.readOnly = false;
            input.disabled = true;
            input.value = "";
        } else if (gl) {
            cell.classList.add("locked");
            input.readOnly = false;
            input.disabled = true;
            if (input.value !== f.value) input.value = f.value;
        } else {
            input.readOnly = false;
            input.disabled = false;
            if (input.value !== f.value) input.value = f.value;
        }
    });

    const showVerdict = !fxBusy();

    els.globalLock.classList.toggle("visible", gl && showVerdict);
    if (gl && showVerdict) {
        const ms = new Date(state.global_locked_until).getTime() - Date.now();
        els.globalLock.innerHTML = `<div class="label">Reviens plus tard</div><div class="countdown">${fmtCountdown(ms)}</div>`;
    } else {
        els.globalLock.innerHTML = "";
    }
    els.submitBtn.disabled = gl;

    const won = state.all_solved && showVerdict;
    els.submitRow.style.display = won ? "none" : "flex";
    if (won) revealFinal();

    renderStatus();
}

function copyText(txt) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(
        () => setStatus("Copié : " + txt),
        () => setStatus("Copie impossible."),
    );
}

/* ---------- Carte finale ---------- */

let finalState = "idle";
let finalRetryAt = 0;

async function revealFinal() {
    if (finalState !== "idle" || Date.now() < finalRetryAt) return;
    finalState = "loading";
    try {
        const r = await fetch("/api/reveal");
        if (!r.ok) throw new Error("http " + r.status);
        renderFinal(await r.json());
        finalState = "done";
    } catch (e) {
        finalState = "idle";
        finalRetryAt = Date.now() + 5000;
        setStatus("Révélation impossible pour l'instant.");
    }
}

function renderFinal(data) {
    els.final.innerHTML = "";

    const h = document.createElement("h2");
    h.textContent = data.title || "Bravo";
    els.final.appendChild(h);

    if (data.note) {
        const p = document.createElement("p");
        p.textContent = data.note;
        els.final.appendChild(p);
    }

    const row = document.createElement("div");
    row.className = "final-actions";

    if (data.payload) {
        const copy = document.createElement("button");
        copy.textContent = "Copier";
        copy.addEventListener("click", () => copyText(data.payload));
        row.appendChild(copy);
    }

    (data.actions || []).forEach((action) => {
        if (action.type === "copy") {
            const btn = document.createElement("button");
            btn.textContent = action.label || "Copier";
            btn.addEventListener("click", () => copyText(action.value || data.payload || ""));
            row.appendChild(btn);
        } else if (action.type === "link" && action.href) {
            const a = document.createElement("a");
            a.className = "btn";
            a.href = action.href;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = action.label || "Ouvrir";
            row.appendChild(a);
        }
    });

    els.final.appendChild(row);
    els.final.classList.add("visible");
}

els.submitBtn.addEventListener("click", submitAll);

loadState();
setInterval(render, 1000);
setInterval(loadState, 30000);
