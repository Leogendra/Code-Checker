# Specs : site de vérification d'énigmes GPS avec anti bruteforce

## 1. Objectif

Vérifier 8 réponses (2 chiffres chacune) formant des coordonnées GPS, via un backend qui compare des hash sans jamais exposer les réponses, avec un blocage type 1 essai/heure après une mauvaise réponse.

## 2. Architecture générale

- Frontend statique vanilla : HTML/CSS/JS, un formulaire de 8 champs.
- Backend léger : Flask (Python) ou Express (Node.js), 3 routes.
- Stockage persistant côté serveur uniquement : SQLite (ou fichier JSON si volume très faible).
- Hébergement : n'importe quel service capable de faire tourner un petit process (Render, Railway, Fly.io, PythonAnywhere), ou une VM perso. Le frontend peut être servi par le même serveur.

## 3. Modèle de données

Table `fields` (une ligne par énigme, id 0 à 7) :
- id INTEGER PK
- salt TEXT (aléatoire, généré une fois par champ)
- hash TEXT = sha256(salt + valeur_correcte)
- solved BOOLEAN DEFAULT false
- locked_until DATETIME NULL (null = pas de blocage)

Table `final` (une seule ligne) :
- message TEXT : coordonnées GPS, lien d'ouverture Google Maps. Stocké en clair côté serveur, jamais transmis avant que les 8 fields soient solved=true.

## 4. Endpoints API

### GET /api/state
Retourne pour chaque champ : `{id, solved, locked_until}`.
Ne renvoie jamais salt ni hash.
Usage : au chargement de la page, pour afficher l'état (vert / rouge avec minuteur / neutre) sans rien révéler.

### POST /api/check
Body : `{field_id, value}`

Logique serveur, dans l'ordre :
1. Vérifie que field_id est valide (0-7).
2. Si déjà `solved=true` : renvoie `{correct:true, already_solved:true}` sans recalcul.
3. Si `locked_until` existe et est dans le futur : renvoie `{correct:false, locked:true, retry_at:locked_until}` sans même comparer le hash.
4. Sinon calcule `sha256(salt + value)` et compare au hash stocké :
   - Égal : `solved=true`, `locked_until=null`, renvoie `{correct:true}`.
   - Différent : `locked_until = maintenant + 1h`, renvoie `{correct:false, locked:true, retry_at:locked_until}`.
5. Ajoute `all_solved:true` à la réponse si les 8 champs sont solved.

### GET /api/reveal
Vérifie que les 8 champs sont solved=true, sinon 403.
Si oui, renvoie le contenu de la table `final`.

## 5. Anti bruteforce

- Le verrou n'est posé qu'après une mauvaise réponse. Une bonne réponse au premier essai ne déclenche jamais d'attente.
- Granularité par champ, pas globale : les champs déjà trouvés ne bloquent pas les autres.
- Optionnel : verrou global additionnel si trop d'erreurs sur des champs différents en peu de temps (ex : 4 erreurs en moins de 10 minutes bloquent tout le site 1h), pour contrer un script qui teste tous les champs en boucle rapide.
- Pas besoin de session ni de compte (usage mono utilisateur) : le verrou est stocké côté serveur par field_id, pas par IP ni cookie.
- Rate limit HTTP en plus (Flask-Limiter ou express-rate-limit, ex : 10 requêtes/minute par IP) pour éviter le spam de requêtes avant même d'atteindre la logique métier.

## 6. Frontend

Layout reproduisant le format GPS :

```
[__][.][__][__][__]      [__][.][__][__][__]
```

Deux groupes de 4 champs à 2 chiffres, séparés par un point puis un espace, pour matérialiser latitude/longitude.

Chaque input correspondant à l'index réel de l'énigme
- au blur ou via un bouton "vérifier", appelle POST /api/check

États d'affichage par champ, à partir de GET /api/state au chargement puis mis à jour après chaque /api/check :
- vert et désactivé si solved
- rouge avec minuteur (retry_at) si locked
- neutre sinon
- Prévoir un affichage groupé : au lieu de révéler si un champs et bon, on ne révèle que si les 8 sont bons (all_solved) ou si un groupe de 4 est bon.

Quand `all_solved:true` est reçu, on affiche un bouton "copy coordinates" qui permet de paste les coordonées ailleurs, et un bouton "reveal" qui appelle GET /api/reveal pour afficher le message final.

## 7. Sécurité

- HTTPS si hébergé publiquement.
- Salt unique par champ.
- Salt et hash jamais renvoyés au client.
- Même domaine pour frontend et backend : pas de configuration CORS particulière nécessaire.

## 8. Stack imposée

Backend : Flask + SQLite (fichier local) + Flask-Limiter pour le rate limit HTTP.
Un fichier `app.py`, plus un script d'initialisation qui seed les 8 couples (salt, hash) et le message final.
Frontend : un seul fichier HTML/CSS/JS servi directement par Flask.