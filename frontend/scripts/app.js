const NUM_FIELDS = 8;
const GROUPS = [[0, 1, 2, 3], [4, 5, 6, 7]];

// Animations : durées alignées sur les keyframes de style.css
const FX_STAGGER_MS = 1000; // décalage entre deux champs (gauche → droite)
const FX_SUCCESS_MS = 1800;
const FX_FAIL_MS = 520;

const state = {
    fields: Array.from({ length: NUM_FIELDS }, (_, i) => ({
        id: i,
        solved: false,
        locked_until: null, // uniquement les verrous admin
        value: "",
    })),
    all_solved: false,
    global_locked_until: null,
};

const els = {
    coords: document.getElementById("coords"),
    status: document.getElementById("status"),
    submitBtn: document.getElementById("submit-btn"),
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

            const fx = document.createElement("span");
            fx.className = "lock-fx";
            fx.setAttribute("aria-hidden", "true");
            fx.innerHTML =
                '<span class="dial"></span>' +
                '<span class="ring ring-inner"></span>' +
                '<span class="ring ring-outer"></span>';

            cell.appendChild(input);
            cell.appendChild(fx);
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
    return !state.fields[fid].solved && !isAdminLocked(fid) && !isGlobalLocked();
}

function isAdminLocked(fid) {
    const lu = state.fields[fid].locked_until;
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

function isGroupSolved(gi) {
    return GROUPS[gi].every((fid) => state.fields[fid].solved);
}

function cellOf(fid) {
    return document.querySelector(`.cell[data-field="${fid}"]`);
}

let fxTimers = [];
let fxRunningUntil = 0;

function clearFx() {
    fxTimers.forEach(clearTimeout);
    fxTimers = [];
    fxRunningUntil = 0;
    document.querySelectorAll(".cell").forEach((cell) => {
        cell.classList.remove("unlocking", "shaking");
        delete cell.dataset.fx;
    });
}

/**
 * Traduit la réponse serveur en étapes d'animation, de gauche à droite.
 * Le serveur ne dit "correct" que si le groupe de 4 est complet ; sinon on ne
 * sait rien du champ ({pending}) et on n'anime pas. Un verrou global signifie
 * qu'au moins une réponse du lot est fausse, sans dire laquelle : tous les
 * champs soumis non révélés tremblent donc, ce qui ne divulgue rien.
 */
function computeFxSteps(data, submittedIds) {
    const results = data.results || {};
    const steps = [];
    submittedIds.forEach((fid) => {
        const res = results[fid] ?? results[String(fid)];
        if (!res || res.skipped) return;
        if (res.correct && !res.pending) steps.push({ fid, kind: "success" });
        else if (data.global_locked) steps.push({ fid, kind: "fail" });
    });
    return steps.sort((a, b) => a.fid - b.fid);
}

// Gèle l'apparence des champs concernés avant le render(), pour que le
// vert / rouge n'apparaisse qu'au moment de l'animation de chaque champ.
function markFxPending(steps) {
    clearFx();
    steps.forEach(({ fid }) => {
        const cell = cellOf(fid);
        if (cell) cell.dataset.fx = "pending";
    });
}

function runFxSequence(steps) {
    if (!steps.length) return;
    const last = steps[steps.length - 1];
    fxRunningUntil =
        Date.now() +
        (steps.length - 1) * FX_STAGGER_MS +
        (last.kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS);

    steps.forEach(({ fid, kind }, i) => {
        const start = setTimeout(() => {
            const cell = cellOf(fid);
            if (!cell) return;
            delete cell.dataset.fx; // libère le style final (vert / rouge)
            cell.classList.add(kind === "success" ? "unlocking" : "shaking");
            const end = setTimeout(() => {
                cell.classList.remove("unlocking", "shaking");
            }, (kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS) + 60);
            fxTimers.push(end);
        }, i * FX_STAGGER_MS);
        fxTimers.push(start);
    });
}

async function submitAll() {
    if (isGlobalLocked()) return;

    const payload = [];
    state.fields.forEach((f) => {
        if (f.solved || isAdminLocked(f.id)) return;
        const v = (f.value || "").trim();
        if (/^\d{1,2}$/.test(v)) payload.push({ field_id: f.id, value: v });
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

function setStatus(msg) {
    els.status.style.display = msg ? "block" : "none";
    els.status.textContent = msg;
}

async function loadState() {
    try {
        const r = await fetch("/api/state");
        const data = await r.json();
        data.fields.forEach((f) => {
            const local = state.fields[f.id];
            local.solved = f.solved;
            local.locked_until = f.locked_until;
            // On rejoue la dernière valeur soumise, sans écraser une saisie en cours
            // (loadState est aussi appelé périodiquement). Le serveur renvoie toujours
            // 2 chiffres ("02") ; on retire le zéro de tête pour l'affichage.
            if (f.solved) local.value = stripZeroPad(f.value) || local.value || "";
            else if (!local.value && f.value) local.value = stripZeroPad(f.value);
        });
        state.all_solved = data.all_solved;
        state.global_locked_until = data.global_locked_until;
        render();
    } catch (e) {
        setStatus("Check ta connexion pelo.");
    }
}

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
    const gl = isGlobalLocked();

    state.fields.forEach((f) => {
        const cell = document.querySelector(`.cell[data-field="${f.id}"]`);
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

    GROUPS.forEach((_, gi) => {
        const groupEl = document.querySelector(`.group[data-group="${gi}"]`);
        groupEl.classList.toggle("revealed", isGroupSolved(gi));
    });

    els.globalLock.classList.toggle("visible", gl);
    if (gl) {
        const ms = new Date(state.global_locked_until).getTime() - Date.now();
        els.globalLock.innerHTML = `<div class="label">...</div><div class="countdown">${fmtCountdown(ms)}</div>`;
        els.submitBtn.disabled = true;
    } else {
        els.globalLock.innerHTML = "";
        els.submitBtn.disabled = false;
    }

    // On attend la fin de la séquence d'ouverture avant de proposer les actions,
    // pour ne pas court-circuiter l'effet de reveal.
    els.actions.style.display =
        state.all_solved && Date.now() >= fxRunningUntil ? "flex" : "none";
}

function copyCoords() {
    const parts = [];
    GROUPS.forEach((ids) => {
        // Chaque champ doit peser 2 chiffres pour reconstruire la coordonnée,
        // même si l'affichage n'a pas de zéro de tête.
        const s = ids.map((i) => (state.fields[i].value ? String(state.fields[i].value).padStart(2, "0") : "??")).join("");
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
els.copyBtn.addEventListener("click", copyCoords);
els.revealBtn.addEventListener("click", reveal);

buildLayout();
loadState();
setInterval(render, 1000);
setInterval(loadState, 30000);
