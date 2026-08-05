const NUM_FIELDS = 8;
const GROUPS = [[0, 1, 2, 3], [4, 5, 6, 7]];
const GROUP_LABELS = ["latitude", "longitude"];

const state = {
    fields: Array.from({ length: NUM_FIELDS }, (_, i) => ({
        id: i,
        solved: false,
        locked_until: null,
        value: "",
    })),
    all_solved: false,
    global_locked_until: null,
};

const els = {
    coords: document.getElementById("coords"),
    status: document.getElementById("status"),
    submitBtn: document.getElementById("submit-btn"),
    // clearBtn: document.getElementById("clear-btn"),
    actions: document.getElementById("actions"),
    copyBtn: document.getElementById("copy-btn"),
    revealBtn: document.getElementById("reveal-btn"),
    final: document.getElementById("final"),
    globalLock: document.getElementById("global-lock"),
};

function buildLayout() {
    els.coords.innerHTML = "";
    GROUPS.forEach((groupIds, gi) => {
        const groupEl = document.createElement("div");
        groupEl.className = "group";
        groupEl.dataset.group = String(gi);

        groupIds.forEach((fid, pos) => {
            if (pos === 1) {
                const dot = document.createElement("span");
                dot.className = "dot";
                dot.textContent = ".";
                groupEl.appendChild(dot);
            }
            const cell = document.createElement("div");
            cell.className = "cell";
            cell.dataset.field = String(fid);

            const input = document.createElement("input");
            input.type = "text";
            input.inputMode = "numeric";
            input.maxLength = 2;
            input.autocomplete = "off";
            input.dataset.field = String(fid);
            input.addEventListener("input", onInput);
            input.addEventListener("keydown", onKey);

            const timer = document.createElement("div");
            timer.className = "timer";

            cell.appendChild(input);
            cell.appendChild(timer);
            groupEl.appendChild(cell);
        });

        els.coords.appendChild(groupEl);
    });
}

function onInput(e) {
    const el = e.target;
    el.value = el.value.replace(/\D/g, "").slice(0, 2);
    state.fields[Number(el.dataset.field)].value = el.value;
    if (el.value.length === 2) {
        const next = findNextEditable(Number(el.dataset.field));
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
    for (let i = fromId + 1; i < NUM_FIELDS; i++) {
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
    return !state.fields[fid].solved && !isFieldLocked(fid);
}

function isFieldLocked(fid) {
    const lu = state.fields[fid].locked_until;
    if (!lu) return false;
    return new Date(lu).getTime() > Date.now();
}

function isGroupSolved(gi) {
    return GROUPS[gi].every((fid) => state.fields[fid].solved);
}

function isGroupLocked(gi) {
    return GROUPS[gi].some((fid) => !state.fields[fid].solved && isFieldLocked(fid));
}

function groupLockUntil(gi) {
    let max = null;
    for (const fid of GROUPS[gi]) {
        if (state.fields[fid].solved) continue;
        const lu = state.fields[fid].locked_until;
        if (!lu) continue;
        const t = new Date(lu).getTime();
        if (t > Date.now() && (max === null || t > max)) max = t;
    }
    return max;
}

async function submitAll() {
    const globalLocked = state.global_locked_until && new Date(state.global_locked_until).getTime() > Date.now();
    if (globalLocked) return;

    const payload = [];
    state.fields.forEach((f) => {
        if (f.solved || isFieldLocked(f.id)) return;
        const v = (f.value || "").trim();
        if (/^\d{2}$/.test(v)) payload.push({ field_id: f.id, value: v });
    });
    if (payload.length === 0) {
        setStatus("Rien à valider : remplis au moins un champ (2 chiffres).");
        return;
    }

    setStatus("Vérification…");
    els.submitBtn.disabled = true;
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
        if (data.global_locked) {
            state.global_locked_until = data.global_retry_at || null;
            render();
            setStatus("Site temporairement verrouillé.");
            return;
        }
        applyBatchResult(data);
        describeBatch(data);
        if (data.all_solved) state.all_solved = true;
    } catch (err) {
        setStatus("Erreur réseau.");
    } finally {
        els.submitBtn.disabled = false;
        render();
    }
}

function applyBatchResult(data) {
    Object.entries(data.results || {}).forEach(([fidStr, res]) => {
        const fid = Number(fidStr);
        if (res.correct) {
            state.fields[fid].solved = true;
            state.fields[fid].locked_until = null;
        }
    });
    Object.entries(data.groups || {}).forEach(([giStr, gres]) => {
        const gi = Number(giStr);
        if (gres.locked && gres.retry_at) {
            GROUPS[gi].forEach((fid) => {
                if (!state.fields[fid].solved) state.fields[fid].locked_until = gres.retry_at;
            });
        }
    });
    if (data.global_locked) state.global_locked_until = data.global_retry_at || null;
}

function describeBatch(data) {
    const parts = [];
    Object.entries(data.groups || {}).forEach(([giStr, gres]) => {
        const gi = Number(giStr);
        const label = GROUP_LABELS[gi] || `bloc ${gi}`;
        if (gres.wrong) parts.push(`${label} : erreur, bloc verrouillé 1 h`);
        else if (gres.locked) parts.push(`${label} : déjà verrouillé`);
        else if (gres.correct && gres.all_solved) parts.push(`${label} : ✓ complet`);
        else if (gres.correct) parts.push(`${label} : ✓ (partiel)`);
    });
    setStatus(parts.join(" · "));
}

function setStatus(msg) {
    els.status.style.display = "block";
    els.status.textContent = msg;
}

async function loadState() {
    try {
        const r = await fetch("/api/state");
        const data = await r.json();
        data.fields.forEach((f) => {
            state.fields[f.id].solved = f.solved;
            state.fields[f.id].locked_until = f.locked_until;
        });
        state.all_solved = data.all_solved;
        state.global_locked_until = data.global_locked_until;
        render();
    } catch (e) {
        setStatus("Impossible de charger l'état.");
    }
}

function fmtCountdown(ms) {
    if (ms <= 0) return "";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const min = m % 60;
    if (h >= 24 * 365) return "∞";
    if (h > 0) return `${h}h${String(min).padStart(2, "0")}`;
    return `${min}:${String(sec).padStart(2, "0")}`;
}

function render() {
    const gl = state.global_locked_until && new Date(state.global_locked_until).getTime() > Date.now();

    state.fields.forEach((f) => {
        const cell = document.querySelector(`.cell[data-field="${f.id}"]`);
        const input = cell.querySelector("input");
        const timer = cell.querySelector(".timer");
        cell.classList.remove("solved", "locked");
        timer.textContent = "";

        const locked = isFieldLocked(f.id);
        if (f.solved) {
            cell.classList.add("solved");
            input.value = f.value || input.value || "**";
            input.disabled = true;
        } else if (locked) {
            cell.classList.add("locked");
            input.disabled = true;
            timer.textContent = fmtCountdown(new Date(f.locked_until).getTime() - Date.now());
        } else {
            input.disabled = !!gl;
            if (input.value !== f.value) input.value = f.value;
        }
    });

    GROUPS.forEach((_, gi) => {
        const groupEl = document.querySelector(`.group[data-group="${gi}"]`);
        groupEl.classList.toggle("revealed", isGroupSolved(gi));
        groupEl.classList.toggle("group-locked", isGroupLocked(gi));
    });

    els.globalLock.classList.toggle("visible", !!gl);
    if (gl) {
        els.globalLock.textContent = `Site verrouillé (trop d'erreurs). Réessaye dans ${fmtCountdown(new Date(state.global_locked_until).getTime() - Date.now())}.`;
        els.submitBtn.disabled = true;
    } else {
        els.submitBtn.disabled = false;
    }

    els.actions.style.display = state.all_solved ? "flex" : "none";
}

function clearInputs() {
    state.fields.forEach((f) => {
        if (f.solved || isFieldLocked(f.id)) return;
        f.value = "";
        const input = document.querySelector(`input[data-field="${f.id}"]`);
        if (input) input.value = "";
    });
    setStatus("");
}

function copyCoords() {
    const parts = [];
    GROUPS.forEach((ids) => {
        const s = ids.map((i) => state.fields[i].value || "??").join("");
        parts.push(s.slice(0, 2) + "." + s.slice(2));
    });
    const txt = parts.join(", ");
    navigator.clipboard.writeText(txt).then(
        () => setStatus("Coordonnées copiées : " + txt),
        () => setStatus("Copie impossible."),
    );
}

async function reveal() {
    try {
        const r = await fetch("/api/reveal");
        if (!r.ok) {
            setStatus("Révélation impossible pour l'instant.");
            return;
        }
        const data = await r.json();
        els.final.innerHTML = "";
        const h = document.createElement("h2");
        h.textContent = "Trouvé";
        els.final.appendChild(h);
        if (data.coords) {
            const p = document.createElement("div");
            p.className = "coords-line";
            p.textContent = data.coords;
            els.final.appendChild(p);
        }
        if (data.maps_url) {
            const a = document.createElement("a");
            a.href = data.maps_url;
            a.target = "_blank";
            a.rel = "noopener";
            a.textContent = "Ouvrir dans Google Maps";
            els.final.appendChild(a);
        }
        if (data.note) {
            const p = document.createElement("p");
            p.textContent = data.note;
            els.final.appendChild(p);
        }
        els.final.classList.add("visible");
    } catch (e) {
        setStatus("Erreur réseau lors de la révélation.");
    }
}

els.submitBtn.addEventListener("click", submitAll);
// els.clearBtn.addEventListener("click", clearInputs);
els.copyBtn.addEventListener("click", copyCoords);
els.revealBtn.addEventListener("click", reveal);

buildLayout();
loadState();
setInterval(render, 1000);
setInterval(loadState, 30000);
