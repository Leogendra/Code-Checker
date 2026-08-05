"""
Copie ce fichier en `config.py` et remplis les valeurs.
`config.py` est git-ignoré : les réponses ne sortiront jamais du serveur.

Les 8 valeurs correspondent aux coordonnées GPS au format :
    AB.CDEFGH   IJ.KLMNOP
    0  1 2 3    4  5 6 7

Chaque valeur est une chaîne de 2 chiffres (garde les zéros de tête).
"""

ANSWERS = [
    "48",  # 0 - lat entiers
    "85",  # 1 - lat déc 1
    "82",  # 2 - lat déc 2
    "20",  # 3 - lat déc 3
    "02",  # 4 - lon entiers
    "34",  # 5 - lon déc 1
    "94",  # 6 - lon déc 2
    "50",  # 7 - lon déc 3
]

FINAL_MESSAGE = {
    "coords": "48.858220, 2.349450",
    "maps_url": "https://www.google.com/maps/?q=48.858220,2.349450",
    "note": "Bravo, tu as trouvé les coordonnées !",
}
