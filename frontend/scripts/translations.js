/* ---------- translations: fr / en dictionaries ---------- */

const TRANSLATIONS = {
    en: {
        /* Player */
        "app_title": "Code Checker",
        "submit": "Validate",
        "copy": "Copy",
        "open": "Open",
        "copied": "Copied: {value}",
        "copy_failed": "Copy failed.",
        "nothing_to_submit": "Nothing to submit: fill in at least one field.",
        "attempt_no_group": "Attempt saved, but no group is complete: nothing to reveal.",
        "network_error": "Network error.",
        "connection_check": "Check your connection.",
        "reveal_unavailable": "Reveal not available right now.",
        "come_back_later": "Come back later",
        "group_reveal_together": "{count} fields will be revealed together",
        "final_default_title": "Well done",
        "error": "Error: {msg}",

        /* Admin */
        "admin_title": "Admin",
        "password": "password",
        "enter": "Enter",
        "wrong_password": "Wrong password.",
        "global_lock_label": "Global lock",
        "lock_site": "Lock site",
        "unlock_site": "Unlock",
        "duration": "Duration",
        "minutes_hint": "minutes (empty = permanent)",
        "player_message": "Player message",
        "message_placeholder": "displayed under fields (empty = none)",
        "send": "Send",
        "clear": "Clear",
        "message_hidden_during_lock": "hidden during global lock",
        "refresh": "Refresh",
        "reset_fields": "Reset fields",
        "lock_btn": "Lock",
        "unlock_btn": "Unlock",
        "solved": "solved",
        "free": "free",
        "locked_permanent": "locked (permanent)",
        "locked_with_countdown": "locked ({cd})",
        "message_shown": "Shown: « {msg} »",
        "no_message_shown": "No message shown.",
        "message_published": "Message published.",
        "message_cleared": "Message cleared.",
        "site_locked": "Site locked ({label}).",
        "site_unlocked": "Site unlocked.",
        "confirm_reset": "Reset all fields (current answers will be lost)?",
        "fields_reset": "Fields reset.",
        "locked_result": "Locked ({label}): {ids}",
        "unlocked_result": "Unlocked: {ids}",
        "permanent": "permanent",
    },
    fr: {
        /* Player */
        "app_title": "Code Checker",
        "submit": "Valider",
        "copy": "Copier",
        "open": "Ouvrir",
        "copied": "Copié : {value}",
        "copy_failed": "Copie impossible.",
        "nothing_to_submit": "Rien à valider : remplis au moins un champ.",
        "attempt_no_group": "Tentative enregistrée, mais aucun groupe complet : rien à révéler.",
        "network_error": "Erreur réseau.",
        "connection_check": "Check ta connexion pelo.",
        "reveal_unavailable": "Révélation impossible pour l'instant.",
        "come_back_later": "Reviens plus tard",
        "group_reveal_together": "{count} champs seront révélés ensemble",
        "final_default_title": "Bravo",
        "error": "Erreur : {msg}",

        /* Admin */
        "admin_title": "Admin",
        "password": "mot de passe",
        "enter": "Entrer",
        "wrong_password": "Mot de passe incorrect.",
        "global_lock_label": "Verrou global",
        "lock_site": "Verrouiller le site",
        "unlock_site": "Déverrouiller",
        "duration": "Durée",
        "minutes_hint": "minutes (vide = permanent)",
        "player_message": "Message joueur",
        "message_placeholder": "affiché sous les champs (vide = aucun)",
        "send": "Envoyer",
        "clear": "Effacer",
        "message_hidden_during_lock": "masqué pendant un verrou global",
        "refresh": "Rafraîchir",
        "reset_fields": "Reset champs",
        "lock_btn": "Verrouiller",
        "unlock_btn": "Déverrouiller",
        "solved": "résolu",
        "free": "libre",
        "locked_permanent": "verrouillé (permanent)",
        "locked_with_countdown": "verrouillé ({cd})",
        "message_shown": "Affiché : « {msg} »",
        "no_message_shown": "Aucun message affiché.",
        "message_published": "Message publié.",
        "message_cleared": "Message effacé.",
        "site_locked": "Site verrouillé ({label}).",
        "site_unlocked": "Site déverrouillé.",
        "confirm_reset": "Réinitialiser tous les champs (les réponses actuelles seront perdues) ?",
        "fields_reset": "Champs réinitialisés.",
        "locked_result": "Verrouillé ({label}) : {ids}",
        "unlocked_result": "Déverrouillé : {ids}",
        "permanent": "permanent",
    },
};

let currentLang = "en";

function setLanguage(lang) {
    if (lang && TRANSLATIONS[lang]) currentLang = lang;
    document.documentElement.lang = currentLang;
    applyTranslations();
}

function t(key, params) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    let s = dict[key];
    if (s === undefined) s = TRANSLATIONS.en[key];
    if (s === undefined) return key;
    if (params) {
        for (const k in params) {
            s = s.replace(new RegExp("\\{" + k + "\\}", "g"), params[k]);
        }
    }
    return s;
}

function applyTranslations(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-translation]").forEach((el) => {
        el.textContent = t(el.dataset.translation);
    });
    scope.querySelectorAll("[data-translation-placeholder]").forEach((el) => {
        el.placeholder = t(el.dataset.translationPlaceholder);
    });
    scope.querySelectorAll("[data-translation-title]").forEach((el) => {
        el.title = t(el.dataset.translationTitle);
    });
    const titleEl = document.querySelector("title[data-translation]");
    if (titleEl) document.title = t(titleEl.dataset.translation);
}

async function loadLanguage() {
    try {
        const r = await fetch("/api/config");
        if (!r.ok) throw new Error("http " + r.status);
        const data = await r.json();
        setLanguage(data.language);
    } catch (e) {
        setLanguage("en");
    }
}
