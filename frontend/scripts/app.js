// field_specs and layout loaded from /api/state on the first call
let fieldSpecs = [];
let layoutData = null;
let layoutBuilt = false;

// Logical groups (reveal rule), provided by GET /api/state.
let groups = [];
let groupOf = {};

const LONG_PRESS_MS = 350;

// Animations: durations aligned with the keyframes in animations.css
const FX_STAGGER_MS = 1500;
const FX_SUCCESS_MS = 1800;
const FX_FAIL_MS = 520;

const state = {
    fields: [],  // populated after the first loadState
    all_solved: false,
    global_locked_until: null,
    message: null,
};

const els = {
    code: document.getElementById("code"),
    status: document.getElementById("status"),
    submitBtn: document.getElementById("submit-btn"),
    submitRow: document.getElementById("submit-row"),
    final: document.getElementById("final"),
    globalLock: document.getElementById("global-lock"),
};

/* ---------- Filtering / validation ---------- */

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

/* ---------- Helpers ---------- */

function cellOf(fid) {
    return document.querySelector(`.cell[data-field="${fid}"]`);
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

function copyText(txt) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(
        () => setStatus(t("copied", { value: txt })),
        () => setStatus(t("copy_failed")),
    );
}

/* ---------- Input ---------- */

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

/* ---------- #status area ---------- */

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

/* ---------- Render ---------- */

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
    if (state.fields.length === 0) return; // layout not built yet

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
        els.globalLock.innerHTML = `<div class="label">${t("come_back_later")}</div><div class="countdown">${fmtCountdown(ms)}</div>`;
    } else {
        els.globalLock.innerHTML = "";
    }
    els.submitBtn.disabled = gl;

    const won = state.all_solved && showVerdict;
    els.submitRow.style.display = won ? "none" : "flex";
    if (won) revealFinal();

    renderStatus();
}

/* ---------- Init ---------- */

els.submitBtn.addEventListener("click", submitAll);

loadState();
setInterval(render, 1000);
setInterval(loadState, 30000);
