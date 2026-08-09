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

function setToken(token) {
    if (token) sessionStorage.setItem("admin_token", token);
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
        showLogin(t("wrong_password"));
        throw new Error("unauthorized");
    }
    if (!r.ok) {
        const txt = await r.text();
        throw new Error(txt || r.statusText);
    }
    const data = await r.json();
    if (data && data.language) setLanguage(data.language);
    return data;
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
    if (f.solved) return t("solved");
    if (!f.locked_until) return t("free");
    if (f.permanent || f.locked_until === PERMANENT_LOCK) return t("locked_permanent");
    const timeMs = new Date(f.locked_until).getTime();
    const now = Date.now();
    if (timeMs <= now) return t("free");
    const s = Math.floor((timeMs - now) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const cd = h > 0 ? `${h}h${pad(m)}` : `${m}:${pad(sec)}`;
    return t("locked_with_countdown", { cd });
}

let _globalUntil = null;

function renderGlobal(data) {
    if (data && "global_locked_until" in data) _globalUntil = data.global_locked_until;
    const lu = _globalUntil;
    const timeMs = lu ? new Date(lu).getTime() : 0;
    const active = lu && timeMs > Date.now();
    els.globalCard.classList.toggle("locked", !!active);
    els.globalCard.classList.toggle("free", !active);
    if (!active) {
        els.globalStatus.textContent = t("free");
        els.globalUnlockBtn.disabled = true;
        return;
    }
    els.globalUnlockBtn.disabled = false;
    if (timeMs > Date.now() + 365 * 24 * 3600 * 1000) {
        els.globalStatus.textContent = t("locked_permanent");
        return;
    }
    const s = Math.floor((timeMs - Date.now()) / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    const cd = h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
    els.globalStatus.textContent = t("locked_with_countdown", { cd });
}

function renderRows(data) {
    els.rows.innerHTML = "";
    data.fields.forEach((f) => {
        const row = document.createElement("div");
        row.className = "row";
        if (f.solved) row.classList.add("solved");
        else if (f.locked_until) {
            const timeMs = new Date(f.locked_until).getTime();
            if (f.permanent || timeMs > Date.now()) row.classList.add("locked");
        }

        const fid = document.createElement("div");
        fid.className = "fid";
        fid.textContent = "#" + f.id;

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = formatLock(f);

        const lockBtn = document.createElement("button");
        lockBtn.textContent = t("lock_btn");
        lockBtn.disabled = f.solved;
        lockBtn.addEventListener("click", () => lockFields([f.id]));

        const unlockBtn = document.createElement("button");
        unlockBtn.textContent = t("unlock_btn");
        unlockBtn.disabled = f.solved || !f.locked_until;
        unlockBtn.addEventListener("click", () => unlockFields([f.id]));

        row.append(fid, status, lockBtn, unlockBtn);
        els.rows.appendChild(row);
    });
}

function renderMessage(msg) {
    els.msgCurrent.textContent = msg ? t("message_shown", { msg }) : t("no_message_shown");
    // Do not overwrite ongoing user input (refresh runs every 15s).
    if (document.activeElement !== els.msgInput) els.msgInput.value = msg || "";
}

async function sendMessage(text) {
    try {
        const data = await api("POST", "/api/admin/message", { message: text });
        renderMessage(data.message);
        setMsg(data.message ? t("message_published") : t("message_cleared"));
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
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
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function globalLock() {
    const minutes = getMinutes();
    try {
        await api("POST", "/api/admin/global-lock", { minutes });
        const label = minutes ? minutes + "min" : t("permanent");
        setMsg(t("site_locked", { label }));
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function globalUnlock() {
    try {
        await api("POST", "/api/admin/global-unlock");
        setMsg(t("site_unlocked"));
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function resetFields() {
    if (!confirm(t("confirm_reset"))) return;
    try {
        await api("POST", "/api/admin/reset");
        setMsg(t("fields_reset"));
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function lockFields(ids) {
    const minutes = getMinutes();
    try {
        await api("POST", "/api/admin/lock", { field_ids: ids, minutes });
        const label = minutes ? `${minutes}min` : t("permanent");
        setMsg(t("locked_result", { label, ids: ids.join(", ") }));
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function unlockFields(ids) {
    try {
        await api("POST", "/api/admin/unlock", { field_ids: ids });
        setMsg(t("unlocked_result", { ids: ids.join(", ") }));
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function login() {
    const token = els.pwd.value.trim();
    if (!token) return;
    setToken(token);
    try {
        await api("GET", "/api/admin/state");
        els.pwd.value = "";
        els.loginMsg.textContent = "";
        showPanel();
        await refresh();
    } catch (e) {
        // showLogin was already called on 401
        if (e.message !== "unauthorized") {
            setToken("");
            showLogin(t("error", { msg: e.message }));
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

loadLanguage();

if (getToken()) {
    api("GET", "/api/admin/state").then(
        (data) => { showPanel(); renderGlobal(data); renderRows(data); renderMessage(data.message); },
        () => { /* showLogin was already called on 401 */ }
    );
} else {
    showLogin();
}

// Local countdown refreshed every second (no refetch)
setInterval(() => {
    if (els.panel.style.display !== "none") renderGlobal();
}, 1000);

// Full refetch every 15s
setInterval(() => {
    if (els.panel.style.display !== "none") refresh();
}, 15000);
