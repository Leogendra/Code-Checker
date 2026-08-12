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
    finalTitle: document.getElementById("final-title"),
    finalNote: document.getElementById("final-note"),
    finalPayload: document.getElementById("final-payload"),
    finalSave: document.getElementById("final-save"),
    finalCurrent: document.getElementById("final-current"),
    lockUntil: document.getElementById("lock-until"),
    lockMsgInput: document.getElementById("lock-msg"),
    lockMsgSend: document.getElementById("lock-msg-send"),
    lockMsgClear: document.getElementById("lock-msg-clear"),
    lockMsgCurrent: document.getElementById("lock-msg-current"),
};

function getLockDuration() {
    if (els.lockUntil.value) {
        const target = new Date(els.lockUntil.value);
        const diffMs = target.getTime() - Date.now();
        if (diffMs > 0) {
            return { minutes: diffMs / 60000, label: target.toLocaleString() };
        }
    }
    const raw = els.minutes.value.trim();
    if (raw !== "") {
        const n = Number(raw);
        if (isFinite(n) && n > 0) return { minutes: n, label: n + "min" };
    }
    return { minutes: null, label: t("permanent") };
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

function fieldStatus(f) {
    if (f.solved) return "solved";
    if (f.value) return "wrong";
    return "waiting";
}

const STATUS_EMOJI = { solved: "✅", wrong: "❌", waiting: "🕛" };

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
    // Avoid clobbering an in-progress edit inside a row (solution input, etc.).
    if (els.rows.contains(document.activeElement)) return;
    els.rows.innerHTML = "";
    data.fields.forEach((f) => {
        const row = document.createElement("div");
        const st = fieldStatus(f);
        row.className = "row " + st;

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = STATUS_EMOJI[st];

        const lastAttempt = document.createElement("div");
        lastAttempt.className = "last-attempt";
        lastAttempt.textContent = st === "waiting" ? "" : (f.value || "");

        const solutionInput = document.createElement("input");
        solutionInput.type = "text";
        solutionInput.className = "solution-input";
        solutionInput.value = f.answer || "";
        solutionInput.autocomplete = "off";
        solutionInput.spellcheck = false;

        const saveBtn = document.createElement("button");
        saveBtn.textContent = t("validate");
        saveBtn.addEventListener("click", () => saveSolution(f.id, solutionInput.value));
        solutionInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") saveSolution(f.id, solutionInput.value);
        });

        const lockBtn = document.createElement("button");
        lockBtn.textContent = t("lock_btn");
        lockBtn.disabled = f.solved;
        lockBtn.addEventListener("click", () => lockFields([f.id]));

        const unlockBtn = document.createElement("button");
        unlockBtn.textContent = t("unlock_btn");
        unlockBtn.disabled = f.solved || !f.locked_until;
        unlockBtn.addEventListener("click", () => unlockFields([f.id]));

        row.append(status, lastAttempt, solutionInput, saveBtn, lockBtn, unlockBtn);
        els.rows.appendChild(row);
    });
}

async function saveSolution(fid, answer) {
    const trimmed = (answer || "").trim();
    if (!trimmed) return;
    try {
        await api("POST", "/api/admin/solution", { field_id: fid, answer: trimmed });
        setMsg(t("solution_saved", { id: fid }));
        // Drop focus so renderRows can safely rebuild the row (see renderRows guard).
        if (els.rows.contains(document.activeElement)) document.activeElement.blur();
        await refresh();
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

function renderMessage(msg) {
    els.msgCurrent.textContent = msg ? t("message_shown", { msg }) : t("no_message_shown");
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

function renderLockMessage(msg) {
    els.lockMsgCurrent.textContent = msg ? t("lock_message_shown", { msg }) : t("no_lock_message_shown");
    if (document.activeElement !== els.lockMsgInput) els.lockMsgInput.value = msg || "";
}

async function sendLockMessage(text) {
    try {
        const data = await api("POST", "/api/admin/lock-message", { message: text });
        renderLockMessage(data.lock_message);
        setMsg(data.lock_message ? t("lock_message_published") : t("lock_message_cleared"));
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

function renderFinalCard(data) {
    const title = data.title || "";
    const note = data.note || "";
    const payload = data.payload || "";
    els.finalCurrent.textContent = payload
        ? t("final_shown", { payload })
        : t("final_no_payload");
    if (document.activeElement !== els.finalTitle) els.finalTitle.value = title;
    if (document.activeElement !== els.finalNote) els.finalNote.value = note;
    if (document.activeElement !== els.finalPayload) els.finalPayload.value = payload;
}

async function saveFinal() {
    try {
        const data = await api("POST", "/api/admin/final", {
            title: els.finalTitle.value.trim(),
            note: els.finalNote.value.trim(),
            payload: els.finalPayload.value.trim(),
        });
        renderFinalCard(data);
        setMsg(t("final_saved"));
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function refresh() {
    try {
        const [stateData, finalData] = await Promise.all([
            api("GET", "/api/admin/state"),
            api("GET", "/api/admin/final"),
        ]);
        renderGlobal(stateData);
        renderRows(stateData);
        renderMessage(stateData.message);
        renderLockMessage(stateData.lock_message);
        renderFinalCard(finalData);
        setMsg("");
    } catch (e) {
        if (e.message !== "unauthorized") setMsg(t("error", { msg: e.message }), true);
    }
}

async function globalLock() {
    const { minutes, label } = getLockDuration();
    try {
        await api("POST", "/api/admin/global-lock", { minutes });
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
    const { minutes, label } = getLockDuration();
    try {
        await api("POST", "/api/admin/lock", { field_ids: ids, minutes });
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
els.lockMsgSend.addEventListener("click", () => sendLockMessage(els.lockMsgInput.value.trim()));
els.lockMsgClear.addEventListener("click", () => { els.lockMsgInput.value = ""; sendLockMessage(""); });
els.lockMsgInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendLockMessage(els.lockMsgInput.value.trim());
});
els.finalSave.addEventListener("click", saveFinal);

loadLanguage();

if (getToken()) {
    Promise.all([
        api("GET", "/api/admin/state"),
        api("GET", "/api/admin/final"),
    ]).then(
        ([stateData, finalData]) => {
            showPanel();
            renderGlobal(stateData);
            renderRows(stateData);
            renderMessage(stateData.message);
            renderLockMessage(stateData.lock_message);
            renderFinalCard(finalData);
        },
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
