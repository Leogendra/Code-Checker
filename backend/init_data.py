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

FIELD_SPECS = CONFIG.get("fields")
if not FIELD_SPECS or not isinstance(FIELD_SPECS, list):
    raise SystemExit('fields manquant dans config.json — liste de {"answer", "length", "alphabet"}')

FINAL = {
    "note": CONFIG.get("final_note", ""),
    "payload": CONFIG.get("final_payload", ""),
}


def _normalize(answer: str, alphabet: str, length: int) -> str:
    if alphabet == "digits":
        return answer.zfill(length)
    if alphabet in ("upper", "alnum", "hex"):
        return answer.upper()
    return answer


def build_data() -> dict:
    fields = []
    for idx, spec in enumerate(FIELD_SPECS):
        answer = spec.get("answer")
        length = int(spec.get("length", 2))
        alphabet = spec.get("alphabet", "digits")
        if not answer or not isinstance(answer, str):
            raise ValueError(f"fields[{idx}].answer manquant ou invalide")
        fields.append({
            "answer": _normalize(answer, alphabet, length),
            "length": length,
            "alphabet": alphabet,
            "solved": False,
            "locked_until": None,
            "value": None,
            "attempts": 0,
            "last_attempt_at": None,
        })
    return {
        "fields": fields,
        "final": FINAL,
        "global_locked_until": None,
        "message": None,
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
