import argparse
import json
import os
import sys

BACKEND_DIR = os.path.dirname(__file__)
ROOT_DIR = os.path.dirname(BACKEND_DIR)
DATA_PATH = os.path.join(BACKEND_DIR, "data.json")
CONFIG_PATH = os.path.join(ROOT_DIR, "config.json")

if not os.path.exists(CONFIG_PATH):
    raise SystemExit("config.json introuvable à la racine du projet.")
with open(CONFIG_PATH, encoding="utf-8") as _f:
    CONFIG = json.load(_f)

ANSWER = CONFIG.get("answer")
if not ANSWER:
    raise SystemExit('answer manquant dans config.json (ex: "answer": "43.174385,2.993759")')

FINAL_NOTE = CONFIG.get("final_note")
if not FINAL_NOTE:
    raise SystemExit('final_note manquant dans config.json')

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
    "note": FINAL_NOTE,
}


def build_data() -> dict:
    if len(ANSWER_PIECES) != 8:
        raise ValueError("ANSWER_PIECES doit contenir exactement 8 valeurs.")
    fields = []
    for idx, value in enumerate(ANSWER_PIECES):
        if not isinstance(value, str) or not value.isdigit():
            raise ValueError(f"ANSWER_PIECES[{idx}] doit être une chaîne de chiffres : {value!r}")
        fields.append(
            {
                # Réponse en clair : data.json ne quitte jamais le serveur et
                # aucune route ne renvoie ce champ au client.
                "answer": value.zfill(2),
                "solved": False,
                "locked_until": None,
                "value": None,            # dernière valeur soumise
                "attempts": 0,            # nombre de tentatives évaluées
                "last_attempt_at": None,
            }
        )
    return {
        "fields": fields,
        "final": FINAL,
        "global_locked_until": None,
        "message": None,  # message libre de l'admin, affiché sous les champs
    }


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
