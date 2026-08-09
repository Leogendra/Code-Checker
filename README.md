# Code Checker

Small puzzle checker: a set of fields forms a code that the player has to find. The server never reveals the answers; each group of fields is only revealed once fully solved, and a wrong answer triggers a global lock (configurable duration, 1h by default). It can be used for treasure hunts, escape rooms, or any other puzzle game.

## Architecture

- **Backend** in Flask. Answers are stored in `backend/data.json` that never leaves the server and no route sends it back to the client. Rate limiting via Flask-Limiter.
- **Frontend** in vanilla HTML/CSS/JS, served directly by Flask.
- **Admin**: `/admin` page, protected by a password, used to lock/unlock fields, force or release the global lock, and reset the game.
- **Language**: fr / en, driven by the `language` key in `config.json` (default `en`). UI strings live in `frontend/scripts/translations.js`; content strings (like `final_note`) can be provided as per-language dicts in `config.json`.

## Installation

1. Install dependencies:
```
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Create a `.env` file at the project root and add the password for the `/admin` page.
```
ADMIN_TOKEN=password
```

3. Game configuration (`config.json` file at the project root):
```json
{
    "language": "en",
    "fields": [
        { "answer": "48", "length": 2, "type": "digits" },
        { "answer": "85", "length": 2, "type": "digits" }
    ],
    "final_note": "Time to head to the coordinates...",
    "final_payload": "48.858370,2.294481",
    "lock_time": 60,
    "groups": [[0], [1]],
    "layout": [[0, ".", 1]]
}
```
  - `language`: UI language, `"en"` or `"fr"` (default `en`).
  - `fields`: per-field spec;
    - `answer`: the correct answer (case-sensitive).
    - `length`: number of characters in the answer (used to size the input box).
    - `type`: 
      * `"digits"`: 0-9  
      * `"letters"`: A-Z, a-z  
      * `"hex"`: 0-9, A-F, case-insensitive  
      * `"upper"`: forces uppercase  
      * `"lower"`: forces lowercase  
      * anything else for free-form input  
  - `final_note`: message shown on reveal.
  - `final_payload`: raw value exposed by the reveal (e.g. GPS coordinates).
  - `lock_time`: lock duration after a wrong answer, in minutes (60 by default).
  - `groups`: logical grouping for progressive reveal.
  - `layout`: visual layout, including separators as string items.

1. Game data: generate `backend/data.json`:  
  This file is created automatically the first time `app.py` starts if it doesn't exist yet. Use `--reset` to regenerate it from scratch (for example after changing `fields` or `final_note` in `config.json`).
```
python backend/init_data.py --reset
```

2. Start the server:
```
python app.py
```
→ http://127.0.0.1:5000 (admin page: http://127.0.0.1:5000/admin)

## Security

- Answers are stored as plain text in `backend/data.json`, but this file stays server-side.
- The anti-bruteforce lock is applied per wrong attempt, not per IP: single-user usage, no session or cookie required.
- HTTP rate limiting on top (Flask-Limiter) to prevent request spam.
