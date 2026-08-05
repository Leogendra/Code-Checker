"""
Initialise data.db à partir de config.py.

Usage :
    python init_db.py            # crée la base si absente, refuse si existante
    python init_db.py --reset    # supprime et recrée la base

Lance ce script UNE SEULE FOIS avant de démarrer app.py.
"""

import argparse
import hashlib
import json
import os
import secrets
import sqlite3
import sys

try:
    from config import ANSWERS, FINAL_MESSAGE
except ImportError:
    print("Erreur : config.py manquant. Copie config.example.py en config.py et remplis les valeurs.")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")


def sha256_hex(salt: str, value: str) -> str:
    return hashlib.sha256((salt + value).encode("utf-8")).hexdigest()


def build_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE fields (
            id INTEGER PRIMARY KEY,
            salt TEXT NOT NULL,
            hash TEXT NOT NULL,
            solved INTEGER NOT NULL DEFAULT 0,
            locked_until TEXT
        );
        CREATE TABLE final (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            message TEXT NOT NULL
        );
        """
    )


def seed(conn: sqlite3.Connection) -> None:
    if len(ANSWERS) != 8:
        raise ValueError("ANSWERS doit contenir exactement 8 valeurs.")
    for idx, value in enumerate(ANSWERS):
        if not isinstance(value, str) or len(value) != 2 or not value.isdigit():
            raise ValueError(f"ANSWERS[{idx}] doit être une chaîne de 2 chiffres, reçu : {value!r}")
        salt = secrets.token_hex(16)
        conn.execute(
            "INSERT INTO fields (id, salt, hash, solved, locked_until) VALUES (?, ?, ?, 0, NULL)",
            (idx, salt, sha256_hex(salt, value)),
        )
    conn.execute(
        "INSERT INTO final (id, message) VALUES (1, ?)",
        (json.dumps(FINAL_MESSAGE, ensure_ascii=False),),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="supprime la base existante avant de la recréer")
    args = parser.parse_args()

    if os.path.exists(DB_PATH):
        if not args.reset:
            print(f"{DB_PATH} existe déjà. Utilise --reset pour la recréer.")
            sys.exit(1)
        os.remove(DB_PATH)

    conn = sqlite3.connect(DB_PATH)
    try:
        build_schema(conn)
        seed(conn)
        conn.commit()
    finally:
        conn.close()

    print(f"Base créée : {DB_PATH}")
    print("8 champs seedés, message final stocké.")


if __name__ == "__main__":
    main()
