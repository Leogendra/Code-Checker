"""
CLI d'administration : verrouiller / déverrouiller des champs sans passer par l'API.

Exemples :
    python manage.py status
    python manage.py lock 3 5              # verrou permanent
    python manage.py lock 2 --hours 24     # verrou 24h
    python manage.py unlock 3 5
    python manage.py reset-attempts        # remet les compteurs mémoire à zéro (redémarre app.py aussi)
"""

import argparse
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")
NUM_FIELDS = 8
PERMANENT_LOCK = "9999-12-31T00:00:00+00:00"


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def connect() -> sqlite3.Connection:
    if not os.path.exists(DB_PATH):
        print(f"{DB_PATH} introuvable. Lance : python init_db.py")
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def cmd_status(_args) -> None:
    conn = connect()
    rows = conn.execute("SELECT id, solved, locked_until FROM fields ORDER BY id").fetchall()
    print(f"{'id':>3}  {'solved':>6}  {'locked_until'}")
    for r in rows:
        lu = r["locked_until"] or "-"
        if lu == PERMANENT_LOCK:
            lu = "permanent"
        print(f"{r['id']:>3}  {str(bool(r['solved'])):>6}  {lu}")


def validate_ids(raw_ids) -> list[int]:
    out = []
    for s in raw_ids:
        try:
            i = int(s)
        except ValueError:
            print(f"field_id invalide : {s}")
            sys.exit(2)
        if not 0 <= i < NUM_FIELDS:
            print(f"field_id hors bornes (0-{NUM_FIELDS - 1}) : {i}")
            sys.exit(2)
        out.append(i)
    return out


def cmd_lock(args) -> None:
    ids = validate_ids(args.field_ids)
    if args.hours is None:
        until = PERMANENT_LOCK
        label = "permanent"
    else:
        if args.hours <= 0:
            print("--hours doit être > 0")
            sys.exit(2)
        until_dt = now_utc() + timedelta(hours=args.hours)
        until = until_dt.isoformat()
        label = f"jusqu'au {until}"
    conn = connect()
    conn.executemany("UPDATE fields SET locked_until = ? WHERE id = ?", [(until, i) for i in ids])
    conn.commit()
    print(f"Verrouillé {ids} ({label}).")


def cmd_unlock(args) -> None:
    ids = validate_ids(args.field_ids)
    conn = connect()
    conn.executemany("UPDATE fields SET locked_until = NULL WHERE id = ?", [(i,) for i in ids])
    conn.commit()
    print(f"Déverrouillé {ids}.")


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Admin CLI pour data.db.")
    sub = p.add_subparsers(dest="cmd", required=True)

    p_status = sub.add_parser("status", help="affiche l'état de chaque champ")
    p_status.set_defaults(func=cmd_status)

    p_lock = sub.add_parser("lock", help="verrouille un ou plusieurs champs")
    p_lock.add_argument("field_ids", nargs="+", help="ids des champs (0-7)")
    p_lock.add_argument("--hours", type=float, default=None, help="durée en heures (défaut : permanent)")
    p_lock.set_defaults(func=cmd_lock)

    p_unlock = sub.add_parser("unlock", help="retire tout verrou (ne touche pas au statut solved)")
    p_unlock.add_argument("field_ids", nargs="+", help="ids des champs (0-7)")
    p_unlock.set_defaults(func=cmd_unlock)

    return p


if __name__ == "__main__":
    args = build_parser().parse_args()
    args.func(args)
