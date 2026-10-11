# Budget mensuel

Tableau de budget personnel gratuit, en français, en anglais et en allemand, sur https://budget-mensuel.ch. Sans compte, les données restent dans le navigateur. Avec un compte facultatif (Google ou e-mail et mot de passe), le budget est synchronisé entre appareils.

Ce fichier est le rappel complet du site : ce qu'il contient, les choix faits, et comment le mettre en ligne.

---

## 1. Structure des fichiers

```
index.html                 le tableau de budget et les réglages (#reglages)
404.html                   page d'erreur en trois langues (GitHub Pages l'exige à la racine)
manifest.webmanifest, sw.js  application installable et utilisable hors ligne
favicon.ico, CNAME, .nojekyll, robots.txt, sitemap.xml, llms.txt

Html/                      toutes les autres pages
  aide.html                mode d'emploi
  compte.html              connexion, inscription, mot de passe oublié, suppression du compte
  contact.html             formulaire de contact
  confidentialite.html     politique de confidentialité (nLPD, RGPD)
  cookies.html             politique de cookies
  conditions.html          conditions d'utilisation (avec prix et remboursement)
  mentions-legales.html    éditeur et hébergeurs
  en/                      versions anglaises : help, privacy, cookies, terms, legal-notice
  de/                      versions allemandes : hilfe, datenschutz, cookies, nutzungsbedingungen, impressum

Css/style.css              tout le style (thèmes clair et sombre)
JavaScript/
  theme.js                 applique le thème choisi avant l'affichage
  config.js                adresse de l'API et jeton des statistiques
  i18n.js                  traductions français / anglais / allemand
  site.js                  commun : HTTPS forcé, bandeau cookies, bouton de thème
  countries.js             données par pays : devise, banques, retenues, épargne
  app.js                   tableau, réglages, historique, journal, synchronisation
  compte.js                page Compte
  fichiers.js              export (JSON, Excel, CSV, PDF, Word, Markdown) et import
  vendor/pdfjs/            pdf.js, pour lire les relevés PDF
  contact.js               formulaire de contact
Fonts/                     polices IBM Plex hébergées sur le site
Img/                       favicon, icônes de l'application, image de partage (1200 x 630)

api/                       serveur séparé du site (Cloudflare Workers), voir api/README.md
  src/handler.js           pays, taux de change, formulaire de contact
  src/auth.js              comptes, sessions, Google, e-mails, synchronisation, nettoyage nocturne
  schema.sql               tables de la base de données
  test/                    29 tests automatiques
```

---

## 2. Ce que fait le site

**Premier lancement.** Le pays est détecté (par l'API, sinon le fuseau horaire, sinon la langue du navigateur) puis proposé dans une liste modifiable. Il règle la devise, le format des montants, les banques proposées, le nom des retenues sur salaire et les produits d'épargne. 17 pays prévus, plus « Autre pays ».

**Le tableau.** Un bloc par compte, repliable (banque, devise, salaire brut, cotisations, impôt, 13e salaire lissé, net calculé, revenus, dépenses, solde), taux de change BCE, épargne, dettes, envies d'achat.
- Montants saisis avec virgule ou point (812,50 = 812.50), signe moins refusé, plafond de 10 millions, message sous le champ.
- Résumé : solde du mois en premier, « Reste après épargne et dettes », alertes (déficit, marge faible, seuil choisi, compte à découvert, budget prévu dépassé, devise sans taux). Sur téléphone, une barre fixe montre le solde.
- Budget prévu par catégorie, comparé au réel.
- Catégorie devinée d'après le libellé, puis apprise quand on la corrige.
- Lignes « ponctuelles », non reprises le mois suivant.
- Naviguer entre les mois ne crée rien : un mois absent propose « Reprendre » (l'épargne et les dettes avancent) ou « Commencer vide ».
- Annuler / Rétablir, « Annuler » après une suppression ou un import, 10 versions gardées sur l'appareil.
- Délai estimé pour chaque envie, repères suisses (3e pilier, provision d'impôts).

**Réglages** (lien « Réglages » en haut de chaque page) :
- langue : français, anglais ou allemand (aussi avec FR / EN / DE en haut de chaque page) ;
- thème : automatique, clair ou sombre (aussi avec le bouton « Thème » en bas de page) ;
- pays et devise, seuil d'alerte du solde, soldes qui avancent ou non ;
- état du compte ;
- historique mois par mois (courbe des 12 derniers mois et tableau) ;
- journal des modifications (300 dernières actions, dans la langue choisie) ;
- vos données : exporter, modèles, importer, versions enregistrées, vider le mois, tout effacer.

**Exporter et importer** (tout se fait dans le navigateur, aucun fichier n'est envoyé) :
- export JSON (sauvegarde complète), Excel .xlsx (onglets Lignes, Mois par mois, Infos), CSV, PDF (rapport), Word .docx (rapport modifiable), Markdown. Les rapports indiquent les taux de change utilisés ;
- réimport exact de tous ces formats. PDF, Word et Markdown contiennent une copie de la sauvegarde (commentaire PDF, partie `customXml` du .docx, commentaire Markdown) avec une empreinte du texte visible : si le fichier a été modifié après l'export, la copie est écartée et les tableaux du rapport sont relus, avec un avertissement ;
- modèles à télécharger (Excel avec listes déroulantes, CSV, Word, Markdown) : on remplace les exemples, on importe, chaque ligne va à sa place ;
- texte libre (fichier .txt, Word, Markdown, PDF) : « libellé : montant (catégorie) », titres de section, lignes « Mois : » et « Compte : », titres de mois pour plusieurs mois. Les dates ne sont jamais prises pour des montants, les lignes de total sont ignorées, un salaire net donné avec le brut n'est pas compté deux fois, seules les vraies devises sont reconnues (« UBS » reste un nom de banque) ;
- aperçu avant tout ajout : mois, compte, section, catégorie, montant, et liste des lignes ignorées ou corrigées. « Ajouter » ne crée pas de doublons, « Remplacer » repart du fichier ;
- import de relevés bancaires CSV, Excel ou PDF : détection des colonnes (date, libellé, montant ou débit/crédit), catégorie devinée d'après le libellé, aperçu modifiable, chaque ligne rangée dans le mois de sa date. Un relevé importé deux fois n'ajoute rien (date, libellé, montant), un mois absent est créé sans recopier d'autres lignes, un salaire déjà saisi n'est pas compté deux fois. Les PDF sont lus avec pdf.js (Apache 2.0), hébergé dans `JavaScript/vendor/pdfjs` et chargé seulement à l'import d'un PDF.

**Compte (facultatif).**
- Inscription et connexion par e-mail et mot de passe (10 caractères minimum), ou avec Google.
- Le mot de passe ne quitte jamais le navigateur : il est transformé en clé (PBKDF2-SHA256, 600 000 tours) avant l'envoi, puis salé et haché encore sur le serveur. Ce choix permet aussi de respecter la limite de 10 ms de calcul de l'offre gratuite de Cloudflare.
- Synchronisation automatique quelques secondes après chaque modification, nouvel essai automatique en cas d'erreur. En cas de modification sur deux appareils en même temps, une fenêtre avec deux boutons nommés demande quelle version garder ; l'autre reste téléchargeable.
- E-mail de confirmation de l'adresse à l'inscription.
- Mot de passe oublié : lien par e-mail valable 60 minutes (via Resend).
- Changement de mot de passe, déconnexion (avec option d'effacer la copie locale), suppression définitive du compte (mot de passe demandé). Compte supprimé après 24 mois sans connexion, avec avertissement 30 jours avant. Âge minimum : 16 ans.
- Protection : cookie de session HttpOnly et Secure, limites de tentatives partagées (dans la base), origine vérifiée, refus d'affichage dans le cadre d'un autre site, et si quelqu'un a créé un compte avec votre adresse, la connexion Google ou le mot de passe oublié lui retire l'accès.

---

## 3. Design

Noir et blanc cassé, traits fins, aucune décoration.

| Rôle | Clair | Sombre | Contraste (WCAG) |
| --- | --- | --- | --- |
| Fond | `#f2f1ec` | `#141414` | |
| Surface | `#f8f7f3` | `#1c1c1b` | |
| Texte | `#151515` | `#ecebe6` | 16,2 / 15,4 (AAA) |
| Texte secondaire | `#55544f` | `#aaa9a2` | 6,7 / 7,8 (AA) |
| Montant négatif | `#a11d1d` | `#f09a92` | 6,9 / 8,6 (AA) |
| Bordure des champs | `#74736d` | `#8d8c86` | 4,2 / 5,5 (minimum 3) |

Les couleurs se changent en haut de `Css/style.css`. Polices IBM Plex Sans et Mono hébergées sur le site (pas de Google Fonts).

Respecté partout : aucun emoji, aucune étoile, aucun dégradé, aucune ombre, aucun coin arrondi, aucun effet de verre, aucune grille de points, aucun flou, aucune couleur néon, pastel ou arc-en-ciel, aucune bande colorée, aucune animation, pas de boutons en pilule, pas de tiret cadratin, pas de faux avis, témoignages ou chiffres, pas de bento, de cartes de fonctionnalités, de démo produit ni de paliers de prix. Un seul bouton d'action principal par page.

---

## 4. Règles en double ou sans objet

| Demandes | Ce qui a été fait |
| --- | --- |
| Dégradés violet et bleu, violet et noir | Aucun dégradé |
| Emojis, icônes emoji, emoji dans les titres | Aucun emoji |
| Bannière cookies, consentement cookies | Un seul bandeau, Accepter et Refuser au même niveau |
| Page RGPD, politique de confidentialité | Une seule page (nLPD et RGPD) |
| CGV, conditions d'utilisation, remboursement | Une page « Conditions d'utilisation » : le site est gratuit, la section 3 explique qu'il n'y a ni vente ni remboursement |
| Domaine, nom de domaine perso | budget-mensuel.ch (fichier `CNAME`) |
| Peu d'animations, scroll, survol, flèches animées | Aucune animation |
| Faux avis, témoignages, métriques | Aucun |
| Paliers de prix, démo, cartes, bento | Sans objet : le site est l'outil lui-même |

---

## 5. Lois prises en compte

- **nLPD** (Suisse) et **art. 45c LTC** : responsable identifié, transferts encadrés, réclamation au PFPDT. L'éditeur réside en Suisse : droit suisse applicable.
- **RGPD** et **loi Informatique et Libertés** pour les visiteurs de l'UE : bases légales, consentement avant la mesure d'audience, choix redemandé après 6 mois, droits des personnes, réclamation CNIL.
- **Comptes** : base de données dans l'Union européenne (juridiction D1 `eu`), données minimales (e-mail, empreinte du mot de passe, identifiant Google), export et suppression en libre-service, suppression après 24 mois sans connexion (avertissement 30 jours avant), âge minimum 16 ans.
- **Mentions légales** : éditeur, adresse, directeur de publication, hébergeurs (art. 3 al. 1 let. s LCD).
- **Accessibilité** : contrastes WCAG AA, navigation au clavier, étiquettes sur tous les champs, messages lus par les lecteurs d'écran, cibles tactiles de 32 px. Audit axe-core WCAG 2.2 AA sans aucun problème.

Ces textes ont été rédigés avec soin mais ne remplacent pas l'avis d'un juriste.

### À compléter ou vérifier avant le lancement
1. **Adresse postale** : remplacez `[Adresse postale à compléter]` (et ses versions anglaise et allemande) en haut du fichier qui génère les pages, ou directement dans `Html/mentions-legales.html`, `Html/confidentialite.html`, `Html/en/legal-notice.html`, `Html/en/privacy.html`, `Html/de/impressum.html` et `Html/de/datenschutz.html`. Une adresse de domiciliation convient.
2. **Data Privacy Framework** : vérifiez sur dataprivacyframework.gov/list que GitHub, Cloudflare et Google y figurent toujours, juste avant le lancement.
3. **Représentant dans l'UE (art. 27 RGPD)** : la politique indique qu'aucun n'est désigné. Faites confirmer par un juriste que l'exception de l'art. 27 al. 2 s'applique.
4. **Dates** : remettez « Dernière mise à jour » des pages légales et `lastmod` du sitemap au jour du lancement.

---

## 6. Mettre en ligne

### Déjà fait
- Site sur GitHub (dépôt `7jok/budget-mensuel`), GitHub Pages sur `main` / `root`.
- Enregistrements DNS dans Cloudflare (4 A vers GitHub, CNAME `www` vers `7jok.github.io`, en « DNS only »).
- Jeton Cloudflare Web Analytics dans `JavaScript/config.js`.

### À faire dès que le domaine est actif
1. **Hostinger** : serveurs de noms `braden.ns.cloudflare.com` et `uma.ns.cloudflare.com`.
2. **Cloudflare** : attendre l'état « Active ».
3. **GitHub** : Settings > Pages > Enforce HTTPS.
4. **API, comptes, e-mails** : suivre `api/README.md` (Email Routing, base de données, Google, Resend, déploiement).
5. **En-têtes de sécurité** : proxy Cloudflare et règles d'en-têtes, voir `api/README.md`, étape 6.
6. **Google Search Console** : propriété Domaine, puis envoyer `sitemap.xml`.

### Mettre à jour le site
```bash
git add .
git commit -m "Ce qui a changé"
git push
```

---

## 7. Vérifications faites

- Parcours complet dans un navigateur, avec la vraie API et une base de données en mémoire : création du budget, journal, historique, changement de langue et de thème, inscription, connexion (bon et mauvais mot de passe), récupération du budget sur un 2e appareil, synchronisation, conflit, mot de passe oublié, connexion Google, suppression du compte, déconnexion avec effacement.
- Toutes les pages en 375 px de large, thèmes clair et sombre : pas de défilement horizontal, aucune erreur JavaScript.
- Tous les liens internes et toutes les traductions vérifiés.
- API : 29 tests automatiques (`cd api && npm test`).
- Rapport de recette du 11 octobre 2026 : chaque scénario rejoué (51 vérifications : virgule décimale, relevé sur un mois absent, relevé importé deux fois, sauvegarde incomplète, navigation entre les mois, reste après épargne, soldes qui avancent, salaire en double, catégories, négatifs, devise sans taux, conflit, suppression annulable, plafond, format CHF, devise piégée, budget prévu, lignes ponctuelles, courbe, annuler, versions, catégories apprises, délai des envies, repères suisses, mobile).
- Version allemande : 21 vérifications (détection, textes, saisie, catégories, export et réimport, modèle, texte libre, application hors ligne).
- 474 clics et 399 liens vérifiés sur toutes les pages, dans les trois langues.
- Import : 28 fichiers écrits à la main (modèles remplis, CSV, textes, Word, Markdown, PDF, fichiers vides ou illisibles) importés un par un, avec vérification de chaque valeur à sa place ; 28 rapports PDF, Word et Markdown réimportés tels quels, modifiés, sans copie, en anglais, en allemand, ou repassés par LibreOffice ; réimport identique de chaque format d'export.

## 8. Tester en local

```bash
python3 -m http.server 8000
```

Puis ouvrez http://localhost:8000. Sans API joignable, le site fonctionne sans compte.
