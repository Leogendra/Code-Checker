const PERMANENT_LOCK = "9999-12-31T00:00:00+00:00";

const els = {
    login: document.getElementById("login"),
    pwd: document.getElementById("pwd"),
    loginBtn: document.getElementById("login-btn"),
    loginMsg: document.getElementById("login-msg"),
    panel: document.getElementById("panel"),
    rows: document.getElementById("rows"),
    msg: document.getElementById("msg"),
    refresh: document.getElementById("refresh"),
    resetBtn: document.getElementById("reset-btn"),
    minutes: document.getElementById("minutes"),
    msgInput: document.getElementById("msg"),
    msgSend: document.getElementById("msg-send"),
    msgClear: document.getElementById("msg-clear"),
    msgCurrent: document.getElementById("msg-current"),
    globalCard: document.getElementById("global-card"),
    globalStatus: document.getElementById("global-status"),
    globalLockBtn: document.getElementById("global-lock-btn"),
    globalUnlockBtn: document.getElementById("global-unlock-btn"),
};

function getMinutes() {
    const raw = els.minutes.value.trim();
    if (raw === "") return null;
    const n = Number(raw);
    if (!isFinite(n) || n <= 0) return null;
    return n;
}

function getToken() {
    return sessionStorage.getItem("admin_token") || "";
}

function setToken(t) {
    if (t) sessionStorage.setItem("admin_token", t);
    else sessionStorage.removeItem("admin_token");
}

async function api(method, path, body) {
    const opts = {
        method,
        headers: { "X-Admin-Token": getToken() },
    };
    if (body !== undefined) {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(body);
    }
    const r = await fetch(path, opts);
    if (r.status === 401) {
        setToken("");
        showLogin("Mot de passe incorrect.");
        throw new Error("unauthorized");
    }
    if (!r.ok) {
        const t = await r.text();
        throw new Error(t || r.statusText);
    }
    return r.json();
}

function showLogin(msg) {
    els.panel.style.display = "none";
    els.login.style.display = "flex";
    els.loginMsg.textContent = msg || "";
    els.loginMsg.classList.toggle("err", !!msg);
    els.pwd.focus();
}

function showPanel() {
    els.login.style.display = "none";
    els.panel.style.display = "flex";
}

function setMsg(text, isErr) {
    els.msg.textContent = text || "";
    els.msg.classList.toggle("err", !!isErr);
}

function formatLock(f) {
    if (f.solved) return "résolu";
    if (!f.locked_until) return "libre";
    if (f.permanent || f.locked_until === PERMANENT_LOCK) return "verrouillé (permanent)";
    const t = new Date(f.locked_until).getTime();
    const now = Date.now();
    if (t <= now) return "libre";
    const s = Math.floor((t - now) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const cd = h > 0 ? `${h}h${pad(m)}` : `${m}:${pad(sec)}`;
    return `verrouillé (${cd})`;
}

let _globalUntil = null;

function renderGlobal(data) {
    if (data && "global_locked_until" in data) _globalUntil = data.global_locked_until;
    const lu = _globalUntil;
    const t = lu ? new Date(lu).getTime() : 0;
    const active = lu && t > Date.now();
    els.globalCard.classList.toggle("locked", !!active);
    els.globalCard.classList.toggle("free", !active);
    if (!active) {
        els.globalStatus.textContent = "libre";
        els.globalUnlockBtn.disabled = true;
        return;
    }
    els.globalUnlockBtn.disabled = false;
    if (t > Date.now() + 365 * 24 * 3600 * 1000) {
        els.globalStatus.textContent = "verrouillé (permanent)";
        return;
    }
    const s = Math.floor((t - Date.now()) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const cd = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    els.globalStatus.textContent = `verrouillé (${cd})`;
}

function renderRows(data) {
    els.rows.innerHTML = "";
    data.fields.forEach((f) => {
        const row = document.createElement("div");
        row.className = "row";
        if (f.solved) row.classList.add("solved");
        else if (f.locked_until) {
            const t = new Date(f.locked_until).getTime();
            if (f.permanent || t > Date.now()) row.classList.add("locked");
        }

        const fid = document.createElement("div");
        fid.className = "fid";
        fid.textContent = "#" + f.id;

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = formatLock(f);

        const lockBtn = document.createElement("button");
        lockBtn.textContent = "Lock";
        lockBtn.disabled = f.solved;
        lockBtn.addEventListener("click", () => lockFields([f.id]));

        const unlockBtn = document.createElement("button");
        unlockBtn.textContent = "Unlock";
        unlockBtn.disabled = f.solved || !f.locked_until;
        unlockBtn.addEventListener("click", () => unlockFields([f.id]));

        row.append(fid, status, lockBtn, unlockBtn);
        els.rows.appendChild(row);
    });
}

function renderMessage(msg) {
    els.msgCurrent.textContent = msg ? `Affiché : « ${msg} »` : "Aucun message affiché.";
    // Ne pas écraser une saisie en cours (refresh tourne toutes les 15s).
    if (document.activeElement !== els.msgInput) els.msgInput.value = msg || "";
}

async function sendMessage(text) {
    try {
        const data = await api("POST", "/api/admin/message", { message: text });
        renderMessage(data.message);
        setMsg(data.message ? "Message publié." : "Message effacé.");
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function refresh() {
    try {
        const data = await api("GET", "/api/admin/state");
        renderGlobal(data);
        renderRows(data);
        renderMessage(data.message);
        setMsg("");
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function globalLock() {
    const minutes = getMinutes();
    try {
        await api("POST", "/api/admin/global-lock", { minutes });
        setMsg(`Site verrouillé (${minutes ? minutes + "min" : "permanent"}).`);
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function globalUnlock() {
    try {
        await api("POST", "/api/admin/global-unlock");
        setMsg("Site déverrouillé.");
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function resetFields() {
    if (!confirm("Réinitialiser tous les champs (les réponses actuelles seront perdues) ?")) return;
    try {
        await api("POST", "/api/admin/reset");
        setMsg("Champs réinitialisés.");
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function lockFields(ids) {
    const minutes = getMinutes();
    try {
        await api("POST", "/api/admin/lock", { field_ids: ids, minutes });
        const label = minutes ? `${minutes}min` : "permanent";
        setMsg(`Verrouillé (${label}) : ${ids.join(", ")}`);
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function unlockFields(ids) {
    try {
        await api("POST", "/api/admin/unlock", { field_ids: ids });
        setMsg(`Déverrouillé : ${ids.join(", ")}`);
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg("Erreur : " + e.message, true);
    }
}

async function login() {
    const t = els.pwd.value.trim();
    if (!t) return;
    setToken(t);
    try {
        await api("GET", "/api/admin/state");
        els.pwd.value = "";
        els.loginMsg.textContent = "";
        showPanel();
        await refresh();
    } catch (e) {
        // showLogin déjà appelée si 401
        if (e.message !== "unauthorized") {
            setToken("");
            showLogin("Erreur : " + e.message);
        }
    }
}

els.loginBtn.addEventListener("click", login);
els.pwd.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
els.globalLockBtn.addEventListener("click", globalLock);
els.globalUnlockBtn.addEventListener("click", globalUnlock);
els.refresh.addEventListener("click", refresh);
els.resetBtn.addEventListener("click", resetFields);
els.msgSend.addEventListener("click", () => sendMessage(els.msgInput.value.trim()));
els.msgClear.addEventListener("click", () => { els.msgInput.value = ""; sendMessage(""); });
els.msgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage(els.msgInput.value.trim());
});

if (getToken()) {
    api("GET", "/api/admin/state").then(
        (data) => { showPanel(); renderGlobal(data); renderRows(data); renderMessage(data.message); },
        () => { /* showLogin déjà appelée si 401 */ }
    );
} else {
    showLogin();
}

// décompte local rafraîchi chaque seconde (sans refetch)
setInterval(() => {
    if (els.panel.style.display !== "none") renderGlobal();
}, 1000);

// refetch complet toutes les 15s
setInterval(() => {
    if (els.panel.style.display !== "none") refresh();
}, 15000);
