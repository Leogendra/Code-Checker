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

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")

ANSWER = "43.144385,2.993759"  # coords with format "lat,lon" (with decimals)

ANSWER_PIECES = []
for part in ANSWER.split(","):
    part1, part2 = part.split(".")
    if len(part1) == 1:
        part1 = "0" + part1
    ANSWER_PIECES.append(part1)
    ANSWER_PIECES.append(part2[:2])
    ANSWER_PIECES.append(part2[2:4])
    ANSWER_PIECES.append(part2[4:6])


FINAL_MESSAGE = {
    "coords": ANSWER,
    "maps_url": f"https://www.google.com/maps/?q={ANSWER}",
    "note": "Bravo? Tu as trouvé les coordonnées de la Tour Eiffel !",
}


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
    if len(ANSWER_PIECES) != 8:
        raise ValueError("ANSWER_PIECES doit contenir exactement 8 valeurs.")
    for idx, value in enumerate(ANSWER_PIECES):
        if not isinstance(value, str) or len(value) != 2 or not value.isdigit():
            raise ValueError(f"ANSWER_PIECES[{idx}] doit être une chaîne de 2 chiffres, reçu : {value!r}")
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
