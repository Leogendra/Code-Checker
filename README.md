# Coords finder

## Configuration

La configuration sensible passe par un fichier `.env` à la racine du projet (git-ignoré).

1. Copie le template :

   ```
   cp .env.example .env
   ```

2. Génère un jeton admin :

   ```
   python -c "import secrets;print(secrets.token_urlsafe(24))"
   ```

3. Colle la valeur dans `.env` :

   ```
   ADMIN_TOKEN=<le jeton généré>
   ```

Variables disponibles :

| Variable | Description |
|---|---|
| `ADMIN_TOKEN` | Jeton requis pour appeler `/api/admin/lock` et `/api/admin/unlock`. Tant qu'il vaut `change-me` ou est absent, les endpoints admin renvoient 503. |

Le fichier `.env` est chargé automatiquement par `app.py` via `python-dotenv`. `ANSWER` et `FINAL_MESSAGE` restent configurés dans `init_db.py`.
