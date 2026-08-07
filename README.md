# Code Checker

Petite énigme auto-hébergée : des champs forment un code à trouver.
Le serveur ne révèle jamais les réponses ; chaque groupe de champs n'est révélé
qu'une fois entièrement résolu, et une mauvaise réponse déclenche un verrou
global (durée configurable, 1h par défaut).

## Architecture

- **Backend** : Flask (`app.py`). Réponses stockées en clair dans
  `backend/data.json` (git-ignoré) — ce fichier ne quitte jamais le serveur et
  aucune route ne le renvoie au client. Rate limiting via Flask-Limiter.
- **Frontend** : HTML/CSS/JS vanilla dans `frontend/`, servi directement par
  Flask (pas de build).
- **Admin** : page `/admin`, protégée par un jeton (`ADMIN_TOKEN`), pour
  verrouiller/déverrouiller des champs, forcer ou lever le verrou global, et
  réinitialiser la partie.

## Installation

1. Environnement virtuel :
   ```
   python -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. Secrets (fichier `.env` à la racine) :
   ```
   ADMIN_TOKEN=password
   ```
   - `ADMIN_TOKEN` : mot de passe de la page `/admin`.

3. Configuration de la partie (fichier `config.json` à la racine) :
   ```json
   {
     "answer": "48.858370,2.294481",
     "final_note": "C'est l'heure de se rendre aux coordonnées...",
     "lock_time": 60,
     "groups": [[0], [1, 2, 3], [4], [5, 6, 7]],
     "layout": { "parts": [[0, 1, 2, 3], [4, 5, 6, 7]], "separator": "." }
   }
   ```
   - `answer` : la réponse complète, découpée en champs par `init_data.py`.
   - `final_note` : message affiché à la révélation.
   - `lock_time` : durée du verrou après une mauvaise réponse, en minutes (60 par défaut).
   - `groups` : regroupement logique des champs pour la révélation progressive.
   - `layout` : découpage visuel + séparateur affiché entre les blocs.

   `config.json` est git-ignoré (il contient la réponse).

4. Données de la partie : génère `backend/data.json` :
   ```
   python backend/init_data.py
   ```
   Ce fichier est aussi créé automatiquement au premier démarrage de `app.py`
   s'il n'existe pas encore. Utilise `--reset` pour le régénérer depuis zéro
   (par exemple après avoir changé `answer` ou `final_note` dans `config.json`).

4. Lancer le serveur :
   ```
   python app.py
   ```
   → http://127.0.0.1:5000 (page admin : http://127.0.0.1:5000/admin)

## API

- `GET /api/state` : état des 8 champs (solved/locked/value), sans jamais
  exposer la réponse attendue.
- `POST /api/check` : soumet un lot de réponses. Persiste chaque tentative
  (valeur, compteur, date) ; ne révèle `correct`/`incorrect` que si le groupe
  de 4 concerné est intégralement résolu. Une erreur pose un verrou global
  (`LOCK_TIME` minutes).
- `GET /api/reveal` : renvoie le message final, uniquement si les 8 champs
  sont résolus (403 sinon).
- `GET/POST /api/admin/*` : verrouillage manuel, verrou global, reset —
  protégés par `ADMIN_TOKEN` (header `X-Admin-Token` ou `?token=`).

## Sécurité

- Les réponses (`answer`) sont en clair dans `backend/data.json`, mais ce fichier reste côté serveur, est git-ignoré, et n'est jamais renvoyé par l'API (y compris les routes admin).
- Le verrou d'anti-bruteforce est posé par tentative incorrecte, pas par IP : usage mono-utilisateur, pas de session ni de cookie nécessaire.
- Rate limiting HTTP en plus (Flask-Limiter) pour éviter le spam de requêtes.
