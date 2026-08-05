import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from functools import wraps

from dotenv import load_dotenv
from flask import Flask, g, jsonify, request, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN") or None

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "backend")
DB_PATH = os.path.join(BACKEND_DIR, "data.db")
INIT_SCRIPT = os.path.join(BACKEND_DIR, "init_db.py")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "frontend")


def ensure_db() -> None:
    if os.path.exists(DB_PATH):
        return
    if not os.path.exists(INIT_SCRIPT):
        raise SystemExit(f"{INIT_SCRIPT} introuvable, impossible d'initialiser la base.")
    print(f"{DB_PATH} absent → exécution de init_db.py…", flush=True)
    subprocess.check_call([sys.executable, INIT_SCRIPT], cwd=BACKEND_DIR)


ensure_db()

NUM_FIELDS = 8
GROUPS = [[0, 1, 2, 3], [4, 5, 6, 7]]
LOCK_DURATION = timedelta(hours=1)
PERMANENT_LOCK = "9999-12-31T00:00:00+00:00"

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

limiter = Limiter(get_remote_address, app=app, default_limits=["60 per minute"])

_global_locked_until: datetime | None = None


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


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc: BaseException | None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def global_lock_active() -> datetime | None:
    if _global_locked_until and _global_locked_until > now_utc():
        return _global_locked_until
    return None


def _all_solved(db: sqlite3.Connection) -> bool:
    row = db.execute("SELECT COUNT(*) AS c FROM fields WHERE solved = 1").fetchone()
    return row["c"] == NUM_FIELDS


def _load_fields(db: sqlite3.Connection) -> dict[int, dict]:
    rows = db.execute("SELECT id, salt, hash, solved, locked_until FROM fields ORDER BY id").fetchall()
    return {
        r["id"]: {
            "id": r["id"],
            "salt": r["salt"],
            "hash": r["hash"],
            "solved": bool(r["solved"]),
            "locked_until": r["locked_until"],
        }
        for r in rows
    }


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/admin")
def admin_page():
    return send_from_directory(STATIC_DIR, "admin.html")


@app.get("/api/state")
@limiter.limit("30 per minute")
def api_state():
    db = get_db()
    fields_raw = _load_fields(db)
    now = now_utc()
    fields = []
    for fid in range(NUM_FIELDS):
        f = fields_raw[fid]
        lu = parse_iso(f["locked_until"])
        if lu and lu <= now:
            lu = None
        fields.append({"id": fid, "solved": f["solved"], "locked_until": iso(lu)})
    return jsonify(
        {
            "fields": fields,
            "groups": GROUPS,
            "all_solved": all(x["solved"] for x in fields),
            "global_locked_until": iso(global_lock_active()),
        }
    )


@app.post("/api/check")
@limiter.limit("15 per minute")
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

    db = get_db()
    fields = _load_fields(db)
    now = now_utc()

    results: dict[int, dict] = {}
    correct_ids: list[int] = []
    wrong = False

    for fid, val in cleaned.items():
        f = fields[fid]
        if f["solved"]:
            results[fid] = {"correct": True, "already_solved": True}
            continue
        lu = parse_iso(f["locked_until"])
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
        response["global_locked"] = True
        response["global_retry_at"] = iso(_global_locked_until)
        response["all_solved"] = _all_solved(db)
        return jsonify(response)

    if correct_ids:
        db.executemany(
            "UPDATE fields SET solved = 1, locked_until = NULL WHERE id = ?",
            [(fid,) for fid in correct_ids],
        )
        db.commit()

    response["all_solved"] = _all_solved(db)
    return jsonify(response)


@app.get("/api/reveal")
@limiter.limit("10 per minute")
def api_reveal():
    db = get_db()
    if not _all_solved(db):
        return jsonify({"error": "not all solved"}), 403
    row = db.execute("SELECT message FROM final WHERE id = 1").fetchone()
    if row is None:
        return jsonify({"error": "no final message"}), 500
    return jsonify(json.loads(row["message"]))


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
    db = get_db()
    rows = db.execute("SELECT id, solved, locked_until FROM fields ORDER BY id").fetchall()
    fields = []
    for r in rows:
        lu = r["locked_until"]
        fields.append(
            {
                "id": r["id"],
                "solved": bool(r["solved"]),
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

    db = get_db()
    db.executemany("UPDATE fields SET locked_until = ? WHERE id = ?", [(until_iso, fid) for fid in ids])
    db.commit()
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
    db = get_db()
    db.executemany("UPDATE fields SET locked_until = NULL WHERE id = ?", [(fid,) for fid in ids])
    db.commit()
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
    return jsonify({"global_locked_until": iso(_global_locked_until)})


@app.post("/api/admin/global-unlock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_global_unlock():
    """Libère le verrou global."""
    global _global_locked_until
    _global_locked_until = None
    return jsonify({"global_locked_until": None})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
