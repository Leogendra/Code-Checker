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