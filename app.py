import hashlib
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timedelta, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN") or None

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "backend")
DATA_PATH = os.path.join(BACKEND_DIR, "data.json")
INIT_SCRIPT = os.path.join(BACKEND_DIR, "init_data.py")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "frontend")


def ensure_data() -> None:
    if os.path.exists(DATA_PATH):
        return
    if not os.path.exists(INIT_SCRIPT):
        raise SystemExit(f"{INIT_SCRIPT} introuvable, impossible d'initialiser les données.")
    print(f"{DATA_PATH} absent, running init_data.py...", flush=True)
    subprocess.check_call([sys.executable, INIT_SCRIPT], cwd=BACKEND_DIR)


ensure_data()

NUM_FIELDS = 8
GROUPS = [[0, 1, 2, 3], [4, 5, 6, 7]]
LOCK_DURATION = timedelta(hours=1)
PERMANENT_LOCK = "9999-12-31T00:00:00+00:00"

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
limiter = Limiter(get_remote_address, app=app, default_limits=["60 per minute"])

_data_lock = threading.Lock()


def _load_global_lock() -> datetime | None:
    """Charge le verrou global depuis data.json au démarrage."""
    try:
        data = load_data()
        return parse_iso(data.get("global_locked_until"))
    except Exception:
        return None


def _persist_global_lock(dt: datetime | None) -> None:
    """Sauvegarde le verrou global dans data.json (survit aux redémarrages)."""
    with _data_lock:
        data = load_data()
        data["global_locked_until"] = iso(dt)
        save_data(data)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    return dt.astimezone(timezone.utc).isoformat() if dt else None


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def load_data() -> dict:
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def save_data(data: dict) -> None:
    tmp = DATA_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_PATH)


def global_lock_active() -> datetime | None:
    if _global_locked_until and _global_locked_until > now_utc():
        return _global_locked_until
    return None


_global_locked_until: datetime | None = _load_global_lock()


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(STATIC_DIR, "admin.html")


@app.get("/api/state")
@limiter.limit("30 per minute")
def api_state():
    with _data_lock:
        data = load_data()
    now = now_utc()
    fields = []
    for fid in range(NUM_FIELDS):
        f = data["fields"][fid]
        lu = parse_iso(f.get("locked_until"))
        if lu and lu <= now:
            lu = None
        entry = {"id": fid, "solved": f["solved"], "locked_until": iso(lu)}
        if f["solved"] and f.get("value"):
            entry["value"] = f["value"]
        fields.append(entry)
    return jsonify(
        {
            "fields": fields,
            "groups": GROUPS,
            "all_solved": all(x["solved"] for x in fields),
            "global_locked_until": iso(global_lock_active()),
        }
    )


@app.post("/api/check")
@limiter.limit("5 per minute")
def api_check():
    """
    Batch. Body : {"fields": [{"field_id": int, "value": "X" | "XX"}, ...]}
    Une seule erreur dans le batch → verrou global 1h.
    Champs déjà solved ou verrouillés (admin) → ignorés silencieusement.
    """
    global _global_locked_until
    payload = request.get_json(silent=True) or {}
    submissions = payload.get("fields")
    if not isinstance(submissions, list) or not submissions:
        return jsonify({"error": "invalid payload"}), 400

    gl = global_lock_active()
    if gl:
        return jsonify({"global_locked": True, "global_retry_at": iso(gl)}), 200

    cleaned: dict[int, str] = {}
    for entry in submissions:
        if not isinstance(entry, dict):
            return jsonify({"error": "invalid entry"}), 400
        fid = entry.get("field_id")
        val = entry.get("value")
        if not isinstance(fid, int) or not 0 <= fid < NUM_FIELDS:
            return jsonify({"error": f"invalid field_id: {fid}"}), 400
        if not isinstance(val, str) or len(val) not in (1, 2) or not val.isdigit():
            return jsonify({"error": f"invalid value for field {fid}"}), 400
        cleaned[fid] = val.zfill(2)

    with _data_lock:
        data = load_data()
        now = now_utc()

        results: dict[int, dict] = {}
        correct_ids: list[int] = []
        wrong = False

        for fid, val in cleaned.items():
            f = data["fields"][fid]
            if f["solved"]:
                results[fid] = {"correct": True, "already_solved": True}
                continue
            lu = parse_iso(f.get("locked_until"))
            if lu and lu > now:
                results[fid] = {"skipped": True, "reason": "admin_locked"}
                continue
            candidate = hashlib.sha256((f["salt"] + val).encode("utf-8")).hexdigest()
            if candidate == f["hash"]:
                correct_ids.append(fid)
                results[fid] = {"correct": True}
            else:
                wrong = True
                results[fid] = {"correct": False}

        response: dict = {"results": results}

        if wrong:
            _global_locked_until = now + LOCK_DURATION
            data["global_locked_until"] = iso(_global_locked_until)
            save_data(data)
            response["global_locked"] = True
            response["global_retry_at"] = iso(_global_locked_until)
            response["all_solved"] = all(x["solved"] for x in data["fields"])
            return jsonify(response)

        # Persistance atomique par groupe : on n'écrit que si le groupe est intégralement
        # correct (batch + déjà solved en DB). Sinon les correctes restent en attente.
        correct_set = set(correct_ids)
        to_persist: list[int] = []
        for group_fids in GROUPS:
            group_complete = all(
                (fid in correct_set or data["fields"][fid]["solved"])
                for fid in group_fids
            )
            if group_complete:
                for fid in group_fids:
                    if fid in correct_set:
                        to_persist.append(fid)

        pending_set = correct_set - set(to_persist)
        for fid in pending_set:
            results[fid]["pending"] = True

        if to_persist:
            for fid in to_persist:
                data["fields"][fid]["solved"] = True
                data["fields"][fid]["locked_until"] = None
                data["fields"][fid]["value"] = cleaned[fid]
            save_data(data)

        response["all_solved"] = all(x["solved"] for x in data["fields"])
        return jsonify(response)


@app.get("/api/reveal")
@limiter.limit("10 per minute")
def api_reveal():
    with _data_lock:
        data = load_data()
    if not all(f["solved"] for f in data["fields"]):
        return jsonify({"error": "not all solved"}), 403
    final = data.get("final")
    if not final:
        return jsonify({"error": "no final message"}), 500
    return jsonify(final)


# ---------- admin ----------

def require_admin(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if not ADMIN_TOKEN or ADMIN_TOKEN == "change-me":
            return jsonify({"error": "admin token not configured"}), 503
        provided = request.headers.get("X-Admin-Token") or request.args.get("token")
        if provided != ADMIN_TOKEN:
            return jsonify({"error": "unauthorized"}), 401
        return fn(*args, **kwargs)
    return wrapped


def _validate_ids(raw) -> list[int] | tuple[dict, int]:
    if not isinstance(raw, list) or not raw:
        return {"error": "field_ids required"}, 400
    out = []
    for x in raw:
        if not isinstance(x, int) or not 0 <= x < NUM_FIELDS:
            return {"error": f"invalid field_id: {x}"}, 400
        out.append(x)
    return out


@app.get("/api/admin/state")
@limiter.limit("60 per minute")
@require_admin
def api_admin_state():
    """Retourne l'état complet des champs (locked_until brut, sans masquage temporel)."""
    with _data_lock:
        data = load_data()
    fields = []
    for fid in range(NUM_FIELDS):
        f = data["fields"][fid]
        lu = f.get("locked_until")
        fields.append(
            {
                "id": fid,
                "solved": f["solved"],
                "locked_until": lu,
                "permanent": lu == PERMANENT_LOCK,
            }
        )
    gl = global_lock_active()
    return jsonify(
        {
            "fields": fields,
            "all_solved": all(f["solved"] for f in fields),
            "global_locked_until": iso(gl),
        }
    )


@app.post("/api/admin/lock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_lock():
    """
    Verrouille manuellement des champs (ex : énigme pas encore révélée).
    Body : {"field_ids": [int, ...], "hours": float|null}
    hours=null (défaut) → verrou permanent (jusqu'à unlock explicite).
    """
    payload = request.get_json(silent=True) or {}
    ids = _validate_ids(payload.get("field_ids"))
    if isinstance(ids, tuple):
        return jsonify(ids[0]), ids[1]
    hours = payload.get("hours")
    if hours is None:
        until_iso = PERMANENT_LOCK
    else:
        try:
            hours = float(hours)
        except (TypeError, ValueError):
            return jsonify({"error": "invalid hours"}), 400
        if hours <= 0:
            return jsonify({"error": "hours must be > 0"}), 400
        until_iso = iso(now_utc() + timedelta(hours=hours))

    with _data_lock:
        data = load_data()
        for fid in ids:
            data["fields"][fid]["locked_until"] = until_iso
        save_data(data)
    return jsonify({"locked": ids, "until": until_iso})


@app.post("/api/admin/unlock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_unlock():
    """Retire tout verrou (ne touche pas au statut solved). Body : {"field_ids": [int, ...]}"""
    payload = request.get_json(silent=True) or {}
    ids = _validate_ids(payload.get("field_ids"))
    if isinstance(ids, tuple):
        return jsonify(ids[0]), ids[1]
    with _data_lock:
        data = load_data()
        for fid in ids:
            data["fields"][fid]["locked_until"] = None
        save_data(data)
    return jsonify({"unlocked": ids})


@app.post("/api/admin/global-lock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_global_lock():
    """Force le verrou global. Body : {"hours": float | null}. null → permanent."""
    global _global_locked_until
    payload = request.get_json(silent=True) or {}
    hours = payload.get("hours")
    if hours is None:
        _global_locked_until = datetime(9999, 12, 31, tzinfo=timezone.utc)
    else:
        try:
            hours = float(hours)
        except (TypeError, ValueError):
            return jsonify({"error": "invalid hours"}), 400
        if hours <= 0:
            return jsonify({"error": "hours must be > 0"}), 400
        _global_locked_until = now_utc() + timedelta(hours=hours)
    _persist_global_lock(_global_locked_until)
    return jsonify({"global_locked_until": iso(_global_locked_until)})


@app.post("/api/admin/global-unlock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_global_unlock():
    """Libère le verrou global."""
    global _global_locked_until
    _global_locked_until = None
    _persist_global_lock(None)
    return jsonify({"global_locked_until": None})


@app.post("/api/admin/reset")
@limiter.limit("10 per minute")
@require_admin
def api_admin_reset():
    """Remet tous les champs à non-résolu, sans valeur, sans verrou. Lève aussi le verrou global."""
    global _global_locked_until
    with _data_lock:
        data = load_data()
        for f in data["fields"]:
            f["solved"] = False
            f["value"] = None
            f["locked_until"] = None
        data["global_locked_until"] = None
        save_data(data)
    _global_locked_until = None
    return jsonify({"reset": True})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
