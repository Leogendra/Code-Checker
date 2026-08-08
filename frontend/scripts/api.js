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

/* ---------- Chargement de l'état ---------- */

async function loadState() {
    try {
        const r = await fetch("/api/state");
        const data = await r.json();

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
