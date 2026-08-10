from flask import Flask, jsonify, request, send_from_directory
from datetime import datetime, timedelta, timezone
from flask_limiter.util import get_remote_address
from flask_limiter import Limiter
from dotenv import load_dotenv
from functools import wraps
import subprocess
import threading
import json
import sys
import os

_ROOT_DIR = os.path.dirname(__file__)

load_dotenv(os.path.join(_ROOT_DIR, ".env"))
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN") or None

_CONFIG_PATH = os.path.join(_ROOT_DIR, "config.json")
if not os.path.exists(_CONFIG_PATH):
    raise SystemExit("config.json not found at the project root.")
with open(_CONFIG_PATH, encoding="utf-8") as _f:
    CONFIG = json.load(_f)

try:
    LOCK_TIME_MINUTES = float(CONFIG.get("lock_time", 60))
except (TypeError, ValueError):
    raise SystemExit("Invalid lock_time in config.json: must be a number of minutes.")

_SUPPORTED_LANGS = ("en", "fr")
_raw_lang = CONFIG.get("language", "en")
LANGUAGE = _raw_lang if _raw_lang in _SUPPORTED_LANGS else "en"

BACKEND_DIR = os.path.join(_ROOT_DIR, "backend")
DATA_PATH = os.path.join(BACKEND_DIR, "data.json")
INIT_SCRIPT = os.path.join(BACKEND_DIR, "init_data.py")
STATIC_DIR = os.path.join(os.path.dirname(__file__), "frontend")




def _matches_type(val: str, input_type: str) -> bool:
    if input_type == "digits":
        return val.isdigit()
    if input_type == "letters":
        return val.isalpha()
    if input_type == "hex":
        return all(c in "0123456789abcdefABCDEF" for c in val)
    return True  # "upper", "lower", or anything else: free-form


def _normalize(val: str, input_type: str, length: int) -> str:
    if input_type == "digits":
        return val.zfill(length)
    if input_type in ("hex", "upper"):
        return val.upper()
    if input_type == "lower":
        return val.lower()
    return val


def ensure_data() -> None:
    if os.path.exists(DATA_PATH):
        return
    if not os.path.exists(INIT_SCRIPT):
        raise SystemExit(f"{INIT_SCRIPT} not found, cannot initialize data.")
    print(f"{DATA_PATH} missing, running init_data.py...", flush=True)
    subprocess.check_call([sys.executable, INIT_SCRIPT], cwd=BACKEND_DIR)


ensure_data()

FIELD_SPECS = CONFIG.get("fields")
if not FIELD_SPECS or not isinstance(FIELD_SPECS, list):
    raise SystemExit('Missing "fields" in config.json: list of {"answer", "length", "type"}')

NUM_FIELDS = len(FIELD_SPECS)


def _normalize_groups(raw, num_fields: int) -> list[list[int]]:
    """Filter invalid/duplicate indices and add a singleton for every missing field."""
    seen: set[int] = set()
    groups: list[list[int]] = []
    if isinstance(raw, list):
        for g in raw:
            if not isinstance(g, list):
                continue
            cleaned: list[int] = []
            for i in g:
                if isinstance(i, int) and 0 <= i < num_fields and i not in seen:
                    cleaned.append(i)
                    seen.add(i)
            if cleaned:
                groups.append(cleaned)
    for i in range(num_fields):
        if i not in seen:
            groups.append([i])
    return groups


def _normalize_layout(raw, num_fields: int) -> list[list]:
    """Filter invalid/duplicate indices, keep separators, append missing fields as a single part."""
    seen: set[int] = set()
    parts: list[list] = []
    if isinstance(raw, list):
        for part in raw:
            if not isinstance(part, list):
                continue
            cleaned: list = []
            for item in part:
                if isinstance(item, bool):
                    continue
                if isinstance(item, int):
                    if 0 <= item < num_fields and item not in seen:
                        cleaned.append(item)
                        seen.add(item)
                elif isinstance(item, str):
                    cleaned.append(item)
            if cleaned:
                parts.append(cleaned)
    missing = [i for i in range(num_fields) if i not in seen]
    if missing:
        parts.append(missing)
    return parts


GROUPS = _normalize_groups(CONFIG.get("groups"), NUM_FIELDS)
LAYOUT = _normalize_layout(CONFIG.get("layout"), NUM_FIELDS)
GROUP_OF = {fid: gi for gi, fids in enumerate(GROUPS) for fid in fids}
LOCK_DURATION = timedelta(minutes=LOCK_TIME_MINUTES)
PERMANENT_LOCK = "9999-12-31T00:00:00+00:00"
MESSAGE_MAX_LEN = 280

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
limiter = Limiter(get_remote_address, app=app, default_limits=["60 per minute"])

_data_lock = threading.Lock()


def _load_global_lock() -> datetime | None:
    """Load the global lock from data.json at startup."""
    try:
        data = load_data()
        return parse_iso(data.get("global_locked_until"))
    except Exception:
        return None


def _persist_global_lock(dt: datetime | None) -> None:
    """Save the global lock to data.json (so it survives restarts)."""
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


def group_revealed(data: dict, fid: int) -> bool:
    """
    A field is only revealed (green) once every field in its group is solved.
    Persistence is independent: it happens on every attempt, but the client
    only learns the per-field verdict once the whole group is complete.
    """
    return all(data["fields"][x]["solved"] for x in GROUPS[GROUP_OF[fid]])


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


@app.get("/api/config")
@limiter.limit("60 per minute")
def api_config():
    """Public config exposed to the frontend (language, etc.)."""
    return jsonify({"language": LANGUAGE})


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
        entry = {
            "id": fid,
            # hidden until the group is complete
            "solved": bool(f["solved"]) and group_revealed(data, fid),
            "locked_until": iso(lu),
        }
        # Last submitted value (replayed in the form on reload).
        # Not a leak: it's what the user typed themselves.
        if f.get("value"):
            entry["value"] = f["value"]
        fields.append(entry)
    return jsonify(
        {
            "fields": fields,
            "groups": GROUPS,
            "field_specs": [
                {"id": i, "length": s.get("length", 2), "type": s.get("type", "digits")}
                for i, s in enumerate(FIELD_SPECS)
            ],
            "layout": LAYOUT,
            "all_solved": all(f["solved"] for f in data["fields"]),
            "global_locked_until": iso(global_lock_active()),
            "message": data.get("message") or None,
            "language": LANGUAGE,
        }
    )


@app.post("/api/check")
@limiter.limit("5 per minute")
def api_check():
    """
    Batch. Body: {"fields": [{"field_id": int, "value": "X" | "XX"}, ...]}
    A single wrong answer in the batch triggers the 1h global lock.
    Admin-locked fields are silently ignored.

    Every evaluated attempt is persisted to data.json before responding:
    submitted value, solved status, counter and attempt timestamp. The group
    rule no longer gates the write, only what is revealed to the client.
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
        spec = FIELD_SPECS[fid]
        flen = int(spec.get("length", 2))
        input_type = spec.get("type", "digits")
        if not isinstance(val, str):
            return jsonify({"error": f"invalid value for field {fid}"}), 400
        if input_type == "digits":
            if not val.isdigit() or not (1 <= len(val) <= flen):
                return jsonify({"error": f"invalid value for field {fid}"}), 400
        else:
            val_up = val.upper() if input_type == "hex" else val
            if len(val_up) != flen or not _matches_type(val_up, input_type):
                return jsonify({"error": f"invalid value for field {fid}"}), 400
            val = val_up
        cleaned[fid] = _normalize(val, input_type, flen)

    with _data_lock:
        data = load_data()
        now = now_utc()

        results: dict[int, dict] = {}
        evaluated: list[int] = []
        wrong = False

        for fid, val in cleaned.items():
            f = data["fields"][fid]
            lu = parse_iso(f.get("locked_until"))
            if lu and lu > now:
                results[fid] = {"skipped": True, "reason": "admin_locked"}
                continue

            if f["solved"] and f.get("value") == val:
                # Nothing new to evaluate: don't count an attempt.
                evaluated.append(fid)
                results[fid] = {"correct": True, "already_solved": True}
                continue

            correct = val == f["answer"]
            f["value"] = val
            f["solved"] = correct
            f["attempts"] = int(f.get("attempts") or 0) + 1
            f["last_attempt_at"] = iso(now)
            if correct:
                f["locked_until"] = None
            else:
                wrong = True
            evaluated.append(fid)
            results[fid] = {"correct": correct}

        response: dict = {"results": results}

        if wrong:
            _global_locked_until = now + LOCK_DURATION
            data["global_locked_until"] = iso(_global_locked_until)
            response["global_locked"] = True
            response["global_retry_at"] = iso(_global_locked_until)

        # Single atomic write for everything that was just attempted.
        if evaluated:
            save_data(data)

        # Masking: a field is only revealed if its whole group is solved.
        # Otherwise we don't say correct or wrong, only "pending".
        for fid in evaluated:
            if not group_revealed(data, fid):
                results[fid] = {"pending": True}

        response["all_solved"] = all(f["solved"] for f in data["fields"])
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
    """Return the full field state (raw locked_until, no time masking)."""
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
                "value": f.get("value"),
                "attempts": int(f.get("attempts") or 0),
                "last_attempt_at": f.get("last_attempt_at"),
            }
        )
    gl = global_lock_active()
    return jsonify(
        {
            "fields": fields,
            "all_solved": all(f["solved"] for f in fields),
            "global_locked_until": iso(gl),
            "message": data.get("message") or None,
            "language": LANGUAGE,
        }
    )


@app.post("/api/admin/message")
@limiter.limit("30 per minute")
@require_admin
def api_admin_message():
    """
    Free-form message displayed under the fields on the player side.
    Body: {"message": str | null}. Empty or null clears the message.
    The frontend hides it while a global lock is active.
    """
    payload = request.get_json(silent=True) or {}
    msg = payload.get("message")
    if msg is None:
        msg = ""
    if not isinstance(msg, str):
        return jsonify({"error": "invalid message"}), 400
    msg = msg.strip()[:MESSAGE_MAX_LEN]

    with _data_lock:
        data = load_data()
        data["message"] = msg or None
        save_data(data)
    return jsonify({"message": msg or None})


@app.post("/api/admin/lock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_lock():
    """
    Manually lock fields (e.g. a riddle that hasn't been unlocked yet).
    Body: {"field_ids": [int, ...], "minutes": float|null}
    minutes=null (default) means a permanent lock (until explicit unlock).
    """
    payload = request.get_json(silent=True) or {}
    ids = _validate_ids(payload.get("field_ids"))
    if isinstance(ids, tuple):
        return jsonify(ids[0]), ids[1]
    minutes = payload.get("minutes")
    if minutes is None:
        until_iso = PERMANENT_LOCK
    else:
        try:
            minutes = float(minutes)
        except (TypeError, ValueError):
            return jsonify({"error": "invalid minutes"}), 400
        if minutes <= 0:
            return jsonify({"error": "minutes must be > 0"}), 400
        until_iso = iso(now_utc() + timedelta(minutes=minutes))

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
    """Remove every lock (does not touch the solved status). Body: {"field_ids": [int, ...]}"""
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
    """Force the global lock. Body: {"minutes": float | null}. null means permanent."""
    global _global_locked_until
    payload = request.get_json(silent=True) or {}
    minutes = payload.get("minutes")
    if minutes is None:
        _global_locked_until = datetime(9999, 12, 31, tzinfo=timezone.utc)
    else:
        try:
            minutes = float(minutes)
        except (TypeError, ValueError):
            return jsonify({"error": "invalid minutes"}), 400
        if minutes <= 0:
            return jsonify({"error": "minutes must be > 0"}), 400
        _global_locked_until = now_utc() + timedelta(minutes=minutes)
    _persist_global_lock(_global_locked_until)
    return jsonify({"global_locked_until": iso(_global_locked_until)})


@app.post("/api/admin/global-unlock")
@limiter.limit("30 per minute")
@require_admin
def api_admin_global_unlock():
    """Release the global lock."""
    global _global_locked_until
    _global_locked_until = None
    _persist_global_lock(None)
    return jsonify({"global_locked_until": None})


@app.get("/api/admin/final")
@limiter.limit("30 per minute")
@require_admin
def api_admin_final_get():
    with _data_lock:
        data = load_data()
    return jsonify(data.get("final") or {})


@app.post("/api/admin/final")
@limiter.limit("30 per minute")
@require_admin
def api_admin_final_set():
    payload = request.get_json(silent=True) or {}
    title = payload.get("title", "")
    note = payload.get("note", "")
    final_payload = payload.get("payload", "")
    if not isinstance(title, str) or not isinstance(note, str) or not isinstance(final_payload, str):
        return jsonify({"error": "invalid fields"}), 400
    final = {}
    if title.strip():
        final["title"] = title.strip()
    if note.strip():
        final["note"] = note.strip()
    if final_payload.strip():
        final["payload"] = final_payload.strip()
    with _data_lock:
        data = load_data()
        data["final"] = final
        save_data(data)
    return jsonify(final)


@app.post("/api/admin/reset")
@limiter.limit("10 per minute")
@require_admin
def api_admin_reset():
    """Reset every field to unsolved, no value, no lock. Also releases the global lock."""
    global _global_locked_until
    with _data_lock:
        data = load_data()
        for f in data["fields"]:
            f["solved"] = False
            f["value"] = None
            f["locked_until"] = None
            f["attempts"] = 0
            f["last_attempt_at"] = None
        data["global_locked_until"] = None
        save_data(data)
    _global_locked_until = None
    return jsonify({"reset": True})




if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
