import argparse
import hashlib
import json
import os
import secrets
import sys

DATA_PATH = os.path.join(os.path.dirname(__file__), "data.json")

ANSWER = "43.174385,2.993759"  # coords with format "lat,lon" (with decimals)

ANSWER_PIECES = []
for part in ANSWER.split(","):
    part1, part2 = part.split(".")
    if len(part1) == 1:
        part1 = "0" + part1
    ANSWER_PIECES.append(part1)
    ANSWER_PIECES.append(part2[:2])
    ANSWER_PIECES.append(part2[2:4])
    ANSWER_PIECES.append(part2[4:6])

FINAL = {
    "coords": ANSWER,
    "maps_url": f"https://www.google.com/maps/?q={ANSWER}",
    "note": "Bravo? Tu as trouvé les coordonnées de la Tour Eiffel !",
}


def sha256_hex(salt: str, value: str) -> str:
    return hashlib.sha256((salt + value).encode("utf-8")).hexdigest()


def build_data() -> dict:
    if len(ANSWER_PIECES) != 8:
        raise ValueError("ANSWER_PIECES doit contenir exactement 8 valeurs.")
    fields = []
    for idx, value in enumerate(ANSWER_PIECES):
        if not isinstance(value, str) or not value.isdigit():
            raise ValueError(f"ANSWER_PIECES[{idx}] doit être une chaîne de chiffres : {value!r}")
        salt = secrets.token_hex(16)
        fields.append(
            {
                "salt": salt,
                "hash": sha256_hex(salt, value.zfill(2)),
                "solved": False,
                "locked_until": None,
                "value": None,
            }
        )
    return {"fields": fields, "final": FINAL}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="supprime data.json avant de le recréer")
    args = parser.parse_args()

    if os.path.exists(DATA_PATH):
        if not args.reset:
            print(f"{DATA_PATH} existe déjà. Utilise --reset pour le recréer.")
            sys.exit(1)
        os.remove(DATA_PATH)

    data = build_data()
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Données créées : {DATA_PATH}")


if __name__ == "__main__":
    main()
