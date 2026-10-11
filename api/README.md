# API de Budget mensuel

Serveur séparé du site, sur Cloudflare Workers (offre gratuite), à l'adresse `https://api.budget-mensuel.ch`. Le site fonctionne sans lui, mais il apporte :

| Adresse | Rôle |
| --- | --- |
| `GET /country` | Pays du visiteur (code ISO), déduit par Cloudflare. Rien n'est enregistré. |
| `GET /rates?symbols=CHF,USD` | Taux de référence BCE (base EUR), en cache 6 heures. |
| `POST /contact` | Formulaire de contact, envoyé par e-mail. |
| `POST /auth/register`, `/auth/login`, `/auth/logout` | Inscription (avec e-mail de confirmation), connexion, déconnexion. |
| `POST /auth/verify`, `/auth/verify/resend` | Confirmation de l'adresse e-mail. |
| `GET /auth/google/start` | Connexion avec Google. |
| `POST /auth/forgot`, `/auth/reset` | Mot de passe oublié. |
| `POST /auth/password` | Changer ou définir le mot de passe. |
| `GET /auth/me`, `DELETE /auth/me` | Compte connecté, suppression du compte (mot de passe demandé, ou adresse retapée pour un compte Google). |
| `GET`, `PUT`, `DELETE /budget` | Lire, enregistrer, effacer le budget du compte. |

Chaque nuit (tâche planifiée `crons` dans `wrangler.toml`), l'API efface les sessions, liens et compteurs expirés, avertit par e-mail les comptes sans connexion depuis 23 mois et supprime ceux qui atteignent 24 mois. Les limites de tentatives sont gardées dans la base (table `limits`, clés hachées) : elles valent pour toutes les instances du Worker.

Tout est gratuit dans les limites des offres gratuites : Cloudflare Workers (100 000 requêtes par jour), D1 (5 Go), Resend (3000 e-mails par mois, 100 par jour), Google OAuth.

## Mise en ligne, étape par étape

Prérequis : domaine actif sur Cloudflare, Node.js installé (nodejs.org, version LTS). Toutes les commandes se tapent dans le dossier `api`.

### 1. Adresse e-mail de contact

Dans Cloudflare, domaine `budget-mensuel.ch` :
1. **Email > Email Routing > Get started**.
2. **Destination addresses > Add** : votre adresse personnelle, puis cliquez sur le lien reçu.
3. **Routing rules > Create address** : `aide` vers votre adresse personnelle.
4. Acceptez les enregistrements DNS proposés.

### 2. Connexion à Cloudflare et base de données

```bash
cd api
npx wrangler login
npx wrangler d1 create budget-mensuel-db --jurisdiction=eu --binding=DB --update-config
npx wrangler d1 execute budget-mensuel-db --remote --file=schema.sql
```

La 3e commande crée la base dans l'Union européenne et l'ajoute à `wrangler.toml`. La 4e crée les tables.

### 3. Mettre l'API en ligne

```bash
npx wrangler deploy
npx wrangler secret put MAIL_TO
```

La dernière commande demande l'adresse personnelle qui reçoit les messages du formulaire (celle de l'étape 1). Elle reste privée.

Vérifiez : `https://api.budget-mensuel.ch/country` doit afficher par exemple `{"country":"CH"}`. À partir de là, le formulaire de contact et les comptes par e-mail fonctionnent.

### 4. Connexion avec Google

1. Allez sur console.cloud.google.com et créez un projet « Budget mensuel ».
2. **APIs & Services > OAuth consent screen** : type « External », nom « Budget mensuel », adresse d'assistance `aide@budget-mensuel.ch`, domaine autorisé `budget-mensuel.ch`, liens vers `https://budget-mensuel.ch/Html/confidentialite.html` et `https://budget-mensuel.ch/Html/conditions.html`. Champs d'accès : `openid` et `email` seulement. Publiez l'application (« Publish app »).
3. **Credentials > Create credentials > OAuth client ID** : type « Web application ». Dans **Authorized redirect URIs**, ajoutez exactement :
   `https://api.budget-mensuel.ch/auth/google/callback`
4. Copiez l'identifiant et le secret, puis :

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

### 5. E-mails « mot de passe oublié » (Resend)

1. Créez un compte gratuit sur resend.com.
2. **Domains > Add domain** : `budget-mensuel.ch`. Resend affiche des enregistrements DNS (sur `send.budget-mensuel.ch` et `resend._domainkey`) : ajoutez-les dans Cloudflare, puis cliquez sur **Verify**.
3. **API Keys > Create API Key** (droit « Sending access »), copiez la clé, puis :

```bash
npx wrangler secret put RESEND_API_KEY
```

Les e-mails partent de `noreply@budget-mensuel.ch` : confirmation de l'adresse, mot de passe oublié, avertissement avant suppression d'un compte inactif. Dans Resend, ajoutez aussi l'enregistrement DMARC proposé (`_dmarc`, par exemple `v=DMARC1; p=none; rua=mailto:aide@budget-mensuel.ch`).

### 6. En-têtes de sécurité (après le HTTPS de GitHub)

GitHub Pages n'envoie pas d'en-têtes de sécurité. Une fois que GitHub affiche le certificat HTTPS comme actif :
1. Cloudflare, DNS : passez les 4 enregistrements A et le CNAME `www` en **Proxied** (nuage orange).
2. SSL/TLS, Overview : mode **Full (strict)**.
3. Rules, Transform Rules, **Modify Response Header**, règle « Tout le site » pour `budget-mensuel.ch` et `www.budget-mensuel.ch`, avec « Set static » :
   - `X-Frame-Options` : `DENY`
   - `Content-Security-Policy` : `frame-ancestors 'none'`
   - `Strict-Transport-Security` : `max-age=31536000; includeSubDomains`
   - `X-Content-Type-Options` : `nosniff`
   - `Referrer-Policy` : `strict-origin-when-cross-origin`
   - `Permissions-Policy` : `camera=(), microphone=(), geolocation=()`
4. Vérifiez sur observatory.mozilla.org.

Si GitHub signale plus tard un problème de certificat (renouvellement), repassez ces enregistrements en « DNS only » le temps qu'il se renouvelle, puis remettez-les en « Proxied ».

En attendant, le site refuse déjà d'être affiché dans le cadre d'un autre site (protection dans `site.js`).

### 7. Sauvegarde de la base et journaux

- D1 garde 30 jours d'historique (Time Travel). Testez une fois : `npx wrangler d1 time-travel info budget-mensuel-db`, puis `npx wrangler d1 time-travel restore budget-mensuel-db --timestamp=...` sur une copie si besoin.
- Les journaux du Worker sont activés (`[observability]`) : Workers, budget-mensuel-api, Logs.

## Tester

```bash
npm test
```

29 tests : formulaire de contact (anti-spam, injection d'en-têtes, limites), pays, taux, inscription, connexion, limites de tentatives, synchronisation et conflits, mot de passe oublié, changement de mot de passe, Google (y compris la protection contre un compte créé avec l'adresse de quelqu'un d'autre), suppression du compte avec mot de passe ou adresse retapée, confirmation de l'adresse, corps de requête invalides, limites partagées entre instances, nettoyage nocturne et comptes inactifs.
