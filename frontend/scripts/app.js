const NUM_FIELDS = 8;

// Mise en page GPS : deux blocs de 4 champs séparés par un point.
// Purement visuel — n'a aucun rapport avec les groupes logiques du serveur.
const LAYOUT = [[0, 1, 2, 3], [4, 5, 6, 7]];

// Groupes logiques (règle de révélation), fournis par GET /api/state.
// Le serveur est seul maître de ce découpage : on ne le devine jamais ici.
let groups = LAYOUT.flat().map((fid) => [fid]); // repli : chaque champ seul
let groupOf = Object.fromEntries(groups.map((ids, gi) => ids.map((fid) => [fid, gi])).flat());

const LONG_PRESS_MS = 350; // maintien tactile pour afficher le groupe

// Animations : durées alignées sur les keyframes de style.css
const FX_STAGGER_MS = 1500; // décalage entre deux groupes (gauche → droite)
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
    message: null, // message libre de l'admin
};

const els = {
    coords: document.getElementById("coords"),
    status: document.getElementById("status"),
    submitBtn: document.getElementById("submit-btn"),
    submitRow: document.getElementById("submit-row"),
    final: document.getElementById("final"),
    globalLock: document.getElementById("global-lock"),
};

function buildLayout() {
    els.coords.innerHTML = "";
    LAYOUT.forEach((partIds, pi) => {
        const partEl = document.createElement("div");
        partEl.className = "part";
        partEl.dataset.part = String(pi);

        partIds.forEach((fid, pos) => {
            if (pos === 1) {
                const dot = document.createElement("span");
                dot.className = "dot";
                dot.textContent = ".";
                partEl.appendChild(dot);
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
            bindGroupHint(cell);
            partEl.appendChild(cell);
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
 * Adopte le découpage en groupes envoyé par le serveur et l'inscrit dans le DOM
 * (data-group par cellule). Toute forme invalide retombe sur « chaque champ
 * seul », qui ne promet jamais un regroupement inexistant.
 */
function applyGroups(serverGroups) {
    const valid =
        Array.isArray(serverGroups) &&
        serverGroups.length > 0 &&
        serverGroups.every((ids) => Array.isArray(ids) && ids.length > 0 &&
            ids.every((fid) => Number.isInteger(fid) && fid >= 0 && fid < NUM_FIELDS)) &&
        serverGroups.flat().slice().sort((a, b) => a - b).join(",") ===
            Array.from({ length: NUM_FIELDS }, (_, i) => i).join(",");

    groups = valid ? serverGroups.map((ids) => ids.slice().sort((a, b) => a - b))
                   : Array.from({ length: NUM_FIELDS }, (_, i) => [i]);
    groupOf = {};
    groups.forEach((ids, gi) => ids.forEach((fid) => { groupOf[fid] = gi; }));

    groups.forEach((ids, gi) => ids.forEach((fid) => {
        const cell = cellOf(fid);
        if (cell) cell.dataset.group = String(gi);
    }));
}

function onInput(e) {
    const el = e.target;
    hideGroupHint();
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

function cellOf(fid) {
    return document.querySelector(`.cell[data-field="${fid}"]`);
}

/* ---------- Indicateur de groupe ---------- */

let hintTimer = null;
let hintedGroup = null;

// Un groupe déjà révélé n'a plus rien à indiquer : le serveur ne renvoie
// solved=true que lorsque le groupe entier est résolu.
function isGroupRevealed(gi) {
    return (groups[gi] || []).every((fid) => state.fields[fid].solved);
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

    // Centré sous l'emprise horizontale du groupe (qui peut chevaucher les deux
    // blocs GPS), puis borné pour ne pas sortir de la zone des champs.
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

    // Souris : survol immédiat. Tactile / stylet : maintien.
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
    // Au relâchement seulement pour le tactile : sur souris, un clic ne doit pas
    // faire disparaître l'indicateur alors que le pointeur est toujours dessus.
    cell.addEventListener("pointerup", (e) => {
        if (e.pointerType !== "mouse") hideGroupHint();
    });
    // Un maintien tactile ne doit pas ouvrir le menu contextuel du navigateur.
    cell.addEventListener("contextmenu", (e) => {
        if (hintedGroup !== null) e.preventDefault();
    });
}

let fxTimers = [];
let fxRunningUntil = 0;

// Vrai tant que la séquence d'animation n'est pas terminée.
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

/**
 * Traduit la réponse serveur en étapes d'animation : une étape par groupe, les
 * groupes ordonnés de gauche à droite (par leur champ le plus à gauche). Tous
 * les champs d'une étape s'animent en même temps — un groupe est une serrure,
 * elle s'ouvre d'un bloc.
 *
 * Le serveur ne dit "correct" que si le groupe entier est résolu ; sinon on ne
 * sait rien du champ ({pending}) et on n'anime pas. Un verrou global signifie
 * qu'au moins une réponse du lot est fausse, sans dire laquelle : les champs
 * soumis non révélés tremblent donc, ce qui ne divulgue rien.
 */
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

    // Un groupe révélé s'ouvre en entier, y compris les champs non soumis cette
    // fois-ci (déjà résolus en base mais encore masqués côté client).
    byGroup.forEach((step) => {
        if (step.kind === "success") (groups[step.gi] || []).forEach((fid) => step.fids.add(fid));
    });

    return [...byGroup.values()]
        .map((step) => ({ ...step, fids: [...step.fids].sort((a, b) => a - b) }))
        .sort((a, b) => a.fids[0] - b.fids[0]);
}

// Durée totale de la séquence : un décalage par groupe, plus l'animation du dernier.
function fxTotalMs(steps) {
    if (!steps.length) return 0;
    const last = steps[steps.length - 1];
    return (steps.length - 1) * FX_STAGGER_MS +
        (last.kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS);
}

// Gèle l'apparence des champs concernés avant le render(), pour que le
// vert / rouge n'apparaisse qu'au moment de l'animation de leur groupe.
// Réserve aussi le temps de la séquence dès maintenant : render() est appelé
// avant runFxSequence, et sans ça le verdict s'afficherait une seconde de trop.
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
                delete cell.dataset.fx; // libère le style final (vert / rouge)
                cell.classList.add(kind === "success" ? "unlocking" : "shaking");
            });
            const end = setTimeout(() => {
                cells.forEach((cell) => cell.classList.remove("unlocking", "shaking"));
            }, (kind === "success" ? FX_SUCCESS_MS : FX_FAIL_MS) + 60);
            fxTimers.push(end);
        }, i * FX_STAGGER_MS);
        fxTimers.push(start);
    });

    // Rend le verdict visible dès la dernière serrure jouée, sans attendre le
    // tick de render() (toutes les secondes).
    fxTimers.push(setTimeout(render, Math.max(0, fxRunningUntil - Date.now()) + 80));
}

async function submitAll() {
    if (isGlobalLocked()) return;
    hideGroupHint(); // ne pas superposer le surlignage à la séquence d'animation

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

/* ---------- Zone #status : messages locaux + message de l'admin ---------- */

// Les deux se partagent la même div. Un message local (copie, erreur réseau…)
// passe devant, mais expire : sans ça il masquerait le message admin pour de bon.
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
    // Message admin caché pendant le décompte : on ne parle pas par-dessus le verrou.
    else if (state.message && !isGlobalLocked()) msg = state.message;

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
        applyGroups(data.groups);
        state.all_solved = data.all_solved;
        state.global_locked_until = data.global_locked_until;
        state.message = data.message || null;
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

    // Le groupe surligné vient d'être révélé (fin d'animation, ou /api/state) :
    // on retire l'indicateur sans attendre que le pointeur ressorte.
    if (hintedGroup !== null && isGroupRevealed(hintedGroup)) hideGroupHint();

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

    // Le verdict (chrono de verrouillage / écran de réussite) n'apparaît qu'une
    // fois tous les champs animés : la serrure raconte d'abord, on conclut après.
    const showVerdict = !fxBusy();

    els.globalLock.classList.toggle("visible", gl && showVerdict);
    if (gl && showVerdict) {
        const ms = new Date(state.global_locked_until).getTime() - Date.now();
        els.globalLock.innerHTML = `<div class="label">Reviens plus tard</div><div class="countdown">${fmtCountdown(ms)}</div>`;
    } else {
        els.globalLock.innerHTML = "";
    }
    // Verrouillé = pas de nouvelle tentative, même pendant l'animation.
    els.submitBtn.disabled = gl;

    // Réussite : plus rien à valider, la carte finale prend le relais.
    const won = state.all_solved && showVerdict;
    els.submitRow.style.display = won ? "none" : "flex";
    if (won) revealFinal();

    renderStatus();
}

function copyText(txt) {
    if (!txt) return;
    navigator.clipboard.writeText(txt).then(
        () => setStatus("Coordonnées copiées : " + txt),
        () => setStatus("Copie impossible."),
    );
}

/* ---------- Carte finale ---------- */

// idle → loading → done. render() tourne chaque seconde : sans cet état on
// rappellerait /api/reveal en boucle (et le serveur limite à 10 req/min).
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
        finalRetryAt = Date.now() + 5000; // nouvelle tentative, sans marteler l'API
        setStatus("Révélation impossible pour l'instant.");
    }
}

function renderFinal(data) {
    els.final.innerHTML = "";

    const h = document.createElement("h2");
    h.textContent = "Bravo";
    els.final.appendChild(h);

    if (data.note) {
        const p = document.createElement("p");
        p.textContent = data.note;
        els.final.appendChild(p);
    }

    const row = document.createElement("div");
    row.className = "final-actions";

    const copy = document.createElement("button");
    copy.textContent = "Copier";
    copy.addEventListener("click", () => copyText(data.coords || ""));
    row.appendChild(copy);

    if (data.maps_url) {
        const a = document.createElement("a");
        a.className = "btn";
        a.href = data.maps_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Ouvrir dans Maps";
        row.appendChild(a);
    }

    els.final.appendChild(row);
    els.final.classList.add("visible");
}

els.submitBtn.addEventListener("click", submitAll);

buildLayout();
loadState();
setInterval(render, 1000);
setInterval(loadState, 30000);
