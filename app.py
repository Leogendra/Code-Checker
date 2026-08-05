"""
Serveur Flask : sert le frontend et 3 routes API.

Prérequis :
    python init_db.py

Lancement :
    python app.py
"""

import hashlib
import os
import sqlite3
from datetime import datetime, timedelta, timezone

from flask import Flask, g, jsonify, request, send_from_directory
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
LOCK_DURATION = timedelta(hours=1)
NUM_FIELDS = 8

# Verrou global optionnel : N erreurs sur des champs différents en WINDOW bloquent tout le site.
GLOBAL_LOCK_ERROR_THRESHOLD = 4
GLOBAL_LOCK_WINDOW = timedelta(minutes=10)
GLOBAL_LOCK_DURATION = timedelta(hours=1)

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")

limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["60 per minute"],
)

# Historique des erreurs récentes en mémoire (usage mono-utilisateur, pas besoin de persister).
_recent_errors: list[tuple[int, datetime]] = []
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


def register_error_and_maybe_lock_global(field_id: int) -> datetime | None:
    """Retourne la date de fin du verrou global si le seuil est atteint, sinon None."""
    global _global_locked_until
    now = now_utc()
    _recent_errors.append((field_id, now))
    cutoff = now - GLOBAL_LOCK_WINDOW
    _recent_errors[:] = [(f, t) for f, t in _recent_errors if t >= cutoff]

    distinct_fields = {f for f, _ in _recent_errors}
    if len(distinct_fields) >= GLOBAL_LOCK_ERROR_THRESHOLD:
        _global_locked_until = now + GLOBAL_LOCK_DURATION
        _recent_errors.clear()
        return _global_locked_until
    return None


def global_lock_active() -> datetime | None:
    if _global_locked_until and _global_locked_until > now_utc():
        return _global_locked_until
    return None


@app.get("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/api/state")
@limiter.limit("30 per minute")
def api_state():
    db = get_db()
    rows = db.execute("SELECT id, solved, locked_until FROM fields ORDER BY id").fetchall()
    now = now_utc()
    fields = []
    for row in rows:
        locked_until = parse_iso(row["locked_until"])
        if locked_until and locked_until <= now:
            locked_until = None
        fields.append(
            {
                "id": row["id"],
                "solved": bool(row["solved"]),
                "locked_until": iso(locked_until),
            }
        )
    payload = {
        "fields": fields,
        "all_solved": all(f["solved"] for f in fields),
        "global_locked_until": iso(global_lock_active()),
    }
    return jsonify(payload)


@app.post("/api/check")
@limiter.limit("10 per minute")
def api_check():
    data = request.get_json(silent=True) or {}
    field_id = data.get("field_id")
    value = data.get("value")

    if not isinstance(field_id, int) or not 0 <= field_id < NUM_FIELDS:
        return jsonify({"error": "invalid field_id"}), 400
    if not isinstance(value, str) or len(value) != 2 or not value.isdigit():
        return jsonify({"error": "invalid value"}), 400

    gl = global_lock_active()
    if gl:
        return jsonify({"correct": False, "locked": True, "global": True, "retry_at": iso(gl)})

    db = get_db()
    row = db.execute("SELECT id, salt, hash, solved, locked_until FROM fields WHERE id = ?", (field_id,)).fetchone()
    if row is None:
        return jsonify({"error": "unknown field"}), 404

    if row["solved"]:
        return jsonify({"correct": True, "already_solved": True, "all_solved": _all_solved(db)})

    locked_until = parse_iso(row["locked_until"])
    now = now_utc()
    if locked_until and locked_until > now:
        return jsonify({"correct": False, "locked": True, "retry_at": iso(locked_until)})

    expected = row["hash"]
    candidate = hashlib.sha256((row["salt"] + value).encode("utf-8")).hexdigest()

    if candidate == expected:
        db.execute("UPDATE fields SET solved = 1, locked_until = NULL WHERE id = ?", (field_id,))
        db.commit()
        return jsonify({"correct": True, "all_solved": _all_solved(db)})

    new_lock = now + LOCK_DURATION
    db.execute("UPDATE fields SET locked_until = ? WHERE id = ?", (iso(new_lock), field_id))
    db.commit()
    gl_until = register_error_and_maybe_lock_global(field_id)
    response = {"correct": False, "locked": True, "retry_at": iso(new_lock)}
    if gl_until:
        response["global"] = True
        response["global_retry_at"] = iso(gl_until)
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
    import json

    return jsonify(json.loads(row["message"]))


def _all_solved(db: sqlite3.Connection) -> bool:
    row = db.execute("SELECT COUNT(*) AS c FROM fields WHERE solved = 1").fetchone()
    return row["c"] == NUM_FIELDS


if __name__ == "__main__":
    if not os.path.exists(DB_PATH):
        raise SystemExit(f"{DB_PATH} manquant. Lance d'abord : python init_db.py")
    app.run(host="127.0.0.1", port=5000, debug=False)
