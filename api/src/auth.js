// Comptes et synchronisation du budget (Cloudflare D1).
//
// Mot de passe : le navigateur calcule une clé lourde (PBKDF2-SHA256, 600 000 tours,
// sel dérivé de l'e-mail) et n'envoie que cette clé. Le serveur ajoute un sel aléatoire
// et un SHA-256 avant de stocker. Le mot de passe lui-même ne quitte jamais le navigateur,
// et le calcul lourd ne dépasse pas la limite de 10 ms de l'offre gratuite de Cloudflare.

import {
  json, allowedOrigin, limitedDb, readCookie, cookie, randomToken, sha256Hex,
  b64url, b64urlDecode, hex, fromHex, safeEqual, readJson, EMAIL_RE
} from './util.js';

const SESSION_COOKIE = 'bm_session';
const STATE_COOKIE = 'bm_state';
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const MAX_BUDGET_CHARS = 1_000_000;
const KEY_RE = /^[0-9a-f]{64}$/;
const VERIFY_DAYS = 7;
const DAY = 86400000;
// Comptes inactifs : avertis à 23 mois, supprimés à 24 mois (30 jours après l'avertissement au minimum).
const WARN_AFTER = 700 * DAY;
const DELETE_AFTER = 730 * DAY;

function normEmail(e) { return typeof e === 'string' ? e.trim().toLowerCase() : ''; }
function validEmail(e) { return e.length > 3 && e.length <= 254 && EMAIL_RE.test(e) && !/[\r\n]/.test(e); }

async function hashKey(key) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const data = new Uint8Array(16 + 32);
  data.set(salt); data.set(fromHex(key), 16);
  return `v1$${b64url(salt)}$${hex(await crypto.subtle.digest('SHA-256', data))}`;
}

async function checkKey(stored, key) {
  if (!stored || !KEY_RE.test(key || '')) return false;
  const [v, saltB64, h] = stored.split('$');
  if (v !== 'v1') return false;
  const salt = b64urlDecode(saltB64);
  const data = new Uint8Array(salt.length + 32);
  data.set(salt); data.set(fromHex(key), salt.length);
  return safeEqual(hex(await crypto.subtle.digest('SHA-256', data)), h);
}

function publicUser(u) {
  return { email: u.email, google: !!u.google_sub, password: !!u.password_hash, verified: !!u.email_verified, created_at: u.created_at };
}

async function createSession(env, userId, now) {
  const token = randomToken(32);
  await env.DB.prepare('UPDATE users SET last_seen = ?, warned_at = 0 WHERE id = ?').bind(now, userId).run();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), userId, now + SESSION_DAYS * 86400000).run();
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

async function currentUser(req, env, now) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const th = await sha256Hex(token);
  const row = await env.DB.prepare(
    'SELECT u.*, s.token_hash AS th FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?'
  ).bind(th, now).first();
  if (row && row.last_seen < now - DAY) {
    await env.DB.prepare('UPDATE users SET last_seen = ?, warned_at = 0 WHERE id = ?').bind(now, row.id).run();
  }
  return row || null;
}

function siteUrl(env) { return String(env.SITE_URL || '').replace(/\/$/, ''); }

function redirect(location, cookies) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies || []) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}

async function sendMail(env, deps, to, subject, text) {
  const fetcher = deps.fetch || fetch;
  const r = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.RESET_FROM, to: [to], subject, text })
  });
  if (!r.ok) throw new Error('resend ' + r.status);
}
function mailsOn(env) { return !!(env.RESEND_API_KEY && env.RESET_FROM); }

// Textes des e-mails, en français, anglais ou allemand.
const MAILS = {
  reset: {
    fr: (link) => ['Budget mensuel : nouveau mot de passe', `Bonjour,\n\nPour choisir un nouveau mot de passe pour votre compte Budget mensuel, ouvrez ce lien dans les ${RESET_MINUTES} minutes :\n\n${link}\n\nSi vous n'avez rien demandé, ignorez cet e-mail. Votre mot de passe ne change pas.\n`],
    en: (link) => ['Budget mensuel: reset your password', `Hello,\n\nTo choose a new password for your Budget mensuel account, open this link within ${RESET_MINUTES} minutes:\n\n${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same.\n`],
    de: (link) => ['Budget mensuel: neues Passwort', `Guten Tag\n\nUm ein neues Passwort für Ihr Konto bei Budget mensuel zu wählen, öffnen Sie diesen Link innerhalb von ${RESET_MINUTES} Minuten:\n\n${link}\n\nWenn Sie nichts angefordert haben, ignorieren Sie diese E-Mail. Ihr Passwort bleibt unverändert.\n`]
  },
  verify: {
    fr: (link) => ['Budget mensuel : confirmez votre adresse', `Bonjour,\n\nPour confirmer l'adresse de votre compte Budget mensuel, ouvrez ce lien dans les ${VERIFY_DAYS} jours :\n\n${link}\n\nUne adresse confirmée vous permet de retrouver votre compte si vous oubliez votre mot de passe. Si vous n'avez pas créé de compte, ignorez cet e-mail.\n`],
    en: (link) => ['Budget mensuel: confirm your email address', `Hello,\n\nTo confirm the address of your Budget mensuel account, open this link within ${VERIFY_DAYS} days:\n\n${link}\n\nA confirmed address lets you recover your account if you forget your password. If you did not create an account, ignore this email.\n`],
    de: (link) => ['Budget mensuel: E-Mail-Adresse bestätigen', `Guten Tag\n\nUm die Adresse Ihres Kontos bei Budget mensuel zu bestätigen, öffnen Sie diesen Link innerhalb von ${VERIFY_DAYS} Tagen:\n\n${link}\n\nMit einer bestätigten Adresse können Sie Ihr Konto wiederherstellen, wenn Sie Ihr Passwort vergessen. Wenn Sie kein Konto erstellt haben, ignorieren Sie diese E-Mail.\n`]
  },
  inactive: {
    fr: (link) => ['Budget mensuel : votre compte sera supprimé dans 30 jours', `Bonjour,\n\nVous ne vous êtes pas connecté à votre compte Budget mensuel depuis près de deux ans. Comme l'indique notre politique de confidentialité, le compte et le budget enregistré seront supprimés dans 30 jours.\n\nPour le garder, connectez-vous simplement :\n\n${link}\n\nSi vous ne faites rien, tout sera effacé définitivement.\n\n---\n\nYou have not signed in to your Budget mensuel account for almost two years. It will be deleted in 30 days unless you sign in.\n`]
  }
};
function mail(kind, lang, link) { return (MAILS[kind][lang] || MAILS[kind].fr)(link); }

async function sendVerification(env, deps, user, lang, now) {
  if (!mailsOn(env)) return false;
  const token = randomToken(32);
  await env.DB.prepare('DELETE FROM verifications WHERE user_id = ? OR expires_at < ?').bind(user.id, now).run();
  await env.DB.prepare('INSERT INTO verifications (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), user.id, now + VERIFY_DAYS * DAY).run();
  const [subject, text] = mail('verify', lang, `${siteUrl(env)}/Html/compte.html#verify=${token}`);
  await sendMail(env, deps, user.email, subject, text);
  return true;
}

async function deleteUser(env, id) {
  for (const table of ['budgets', 'resets', 'verifications', 'sessions']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE user_id = ?`).bind(id).run();
  }
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
}

// Tâche planifiée (chaque nuit) : sessions, liens et compteurs expirés, comptes inactifs.
export async function cleanup(env, deps, now) {
  if (!env.DB) return { skipped: true };
  for (const table of ['sessions', 'resets', 'verifications']) {
    await env.DB.prepare(`DELETE FROM ${table} WHERE expires_at < ?`).bind(now).run();
  }
  await env.DB.prepare('DELETE FROM limits WHERE reset_at < ?').bind(now).run();
  let warned = 0, deleted = 0;
  const old = await env.DB.prepare('SELECT * FROM users WHERE last_seen < ? LIMIT 200').bind(now - WARN_AFTER).all();
  for (const u of old.results || []) {
    const due = u.last_seen < now - DELETE_AFTER;
    if (u.warned_at && due && u.warned_at < now - 30 * DAY) {
      await deleteUser(env, u.id); deleted++;
    } else if (!u.warned_at && mailsOn(env)) {
      try {
        const [subject, text] = mail('inactive', 'fr', `${siteUrl(env)}/Html/compte.html`);
        await sendMail(env, deps, u.email, subject, text);
        await env.DB.prepare('UPDATE users SET warned_at = ? WHERE id = ?').bind(now, u.id).run();
        warned++;
      } catch (e) { /* nouvel essai la nuit suivante */ }
    } else if (!u.warned_at && !mailsOn(env) && due) {
      // Sans service d'e-mail, impossible d'avertir : suppression à 24 mois.
      await deleteUser(env, u.id); deleted++;
    }
  }
  return { warned, deleted };
}

export async function handleAuth(req, env, deps, url, now) {
  const p = url.pathname;
  const isAuth = p.startsWith('/auth/') || p === '/budget';
  if (!isAuth) return null;
  if (!env.DB) return json(req, env, 503, { error: 'accounts_unavailable' });

  const ip = req.headers.get('CF-Connecting-IP') || 'inconnu';
  const m = req.method;

  // Google : simple navigation, pas d'appel fetch.
  if (m === 'GET' && p === '/auth/google/start') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return redirect(`${siteUrl(env)}/Html/compte.html#google=indisponible`);
    const state = randomToken(24);
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: `${url.origin}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email',
      state,
      prompt: 'select_account'
    });
    return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, [cookie(STATE_COOKIE, state, 600, '/auth/google')]);
  }

  if (m === 'GET' && p === '/auth/google/callback') {
    const back = `${siteUrl(env)}/Html/compte.html`;
    const clearState = cookie(STATE_COOKIE, '', 0, '/auth/google');
    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    const saved = readCookie(req, STATE_COOKIE);
    if (!code || !state || !saved || !safeEqual(state, saved)) return redirect(`${back}#google=erreur`, [clearState]);
    try {
      const fetcher = deps.fetch || fetch;
      const r = await fetcher('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${url.origin}/auth/google/callback`, grant_type: 'authorization_code'
        })
      });
      if (!r.ok) throw new Error('token');
      const tok = await r.json();
      // Jeton reçu directement de Google en HTTPS avec notre secret : on peut lire son contenu.
      const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(String(tok.id_token).split('.')[1])));
      const okIss = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
      if (!okIss || claims.aud !== env.GOOGLE_CLIENT_ID || !(claims.exp * 1000 > now) || claims.email_verified !== true || !claims.sub) throw new Error('claims');
      const email = normEmail(claims.email);
      let user = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?').bind(claims.sub).first();
      if (!user) {
        user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
        if (user) {
          // Compte e-mail existant. S'il n'a jamais été vérifié, quelqu'un d'autre a pu le créer
          // avec cette adresse : on retire son mot de passe et ses sessions avant de le relier.
          if (!user.email_verified) {
            await env.DB.prepare('UPDATE users SET password_hash = NULL WHERE id = ?').bind(user.id).run();
            await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
          }
          await env.DB.prepare('UPDATE users SET google_sub = ?, email_verified = 1 WHERE id = ?').bind(claims.sub, user.id).run();
        } else {
          const id = crypto.randomUUID();
          await env.DB.prepare('INSERT INTO users (id, email, password_hash, google_sub, email_verified, created_at, last_seen) VALUES (?, ?, NULL, ?, 1, ?, ?)')
            .bind(id, email, claims.sub, now, now).run();
          user = { id };
        }
      }
      const session = await createSession(env, user.id, now);
      return redirect(`${back}#google=ok`, [clearState, session]);
    } catch (e) {
      return redirect(`${back}#google=erreur`, [clearState]);
    }
  }

  // Tout le reste vient du site : l'origine doit être autorisée pour les modifications.
  if (m !== 'GET' && !allowedOrigin(req, env)) return json(req, env, 403, { error: 'forbidden_origin' });

  if (m === 'GET' && p === '/auth/me') {
    const user = await currentUser(req, env, now);
    // 200 dans les deux cas : un visiteur non connecté n'est pas une erreur.
    return json(req, env, 200, { user: user ? publicUser(user) : null });
  }

  if (m === 'POST' && p === '/auth/register') {
    if (await limitedDb(env, 'reg:' + ip, 10, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    const { body, error } = await readJson(req, 2000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    const email = normEmail(body.email);
    if (!validEmail(email)) return json(req, env, 400, { error: 'invalid_email' });
    if (!KEY_RE.test(body.key || '')) return json(req, env, 400, { error: 'invalid_key' });
    const existing = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (existing) return json(req, env, 409, { error: existing.password_hash ? 'exists' : 'exists_google' });
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO users (id, email, password_hash, google_sub, email_verified, created_at, last_seen) VALUES (?, ?, ?, NULL, 0, ?, ?)')
      .bind(id, email, await hashKey(body.key), now, now).run();
    const session = await createSession(env, id, now);
    let mailSent = false;
    try { mailSent = await sendVerification(env, deps, { id, email }, body.lang, now); } catch (e) { mailSent = false; }
    return json(req, env, 201, { user: { email, google: false, password: true, verified: false, created_at: now }, verifySent: mailSent }, { 'Set-Cookie': session });
  }

  if (m === 'POST' && p === '/auth/login') {
    const { body, error } = await readJson(req, 2000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    const email = normEmail(body.email);
    if (await limitedDb(env, 'login:' + ip, 20, 900000, now) || await limitedDb(env, 'login:' + email, 10, 900000, now)) {
      return json(req, env, 429, { error: 'too_many' });
    }
    const user = validEmail(email) ? await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() : null;
    if (!user || !(await checkKey(user.password_hash, body.key))) return json(req, env, 401, { error: 'bad_credentials' });
    const session = await createSession(env, user.id, now);
    return json(req, env, 200, { user: publicUser(user) }, { 'Set-Cookie': session });
  }

  if (m === 'POST' && p === '/auth/logout') {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    return json(req, env, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
  }

  if (m === 'POST' && p === '/auth/forgot') {
    const { body, error } = await readJson(req, 1000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    if (!env.RESEND_API_KEY || !env.RESET_FROM) return json(req, env, 503, { error: 'reset_unavailable' });
    const email = normEmail(body.email);
    if (!validEmail(email)) return json(req, env, 400, { error: 'invalid_email' });
    if (await limitedDb(env, 'forgot:' + ip, 5, 3600000, now) || await limitedDb(env, 'forgot:' + email, 3, 3600000, now)) {
      return json(req, env, 429, { error: 'too_many' });
    }
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (user) {
      const token = randomToken(32);
      await env.DB.prepare('DELETE FROM resets WHERE user_id = ? OR expires_at < ?').bind(user.id, now).run();
      await env.DB.prepare('INSERT INTO resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .bind(await sha256Hex(token), user.id, now + RESET_MINUTES * 60000).run();
      try { const [subject, text] = mail('reset', body.lang, `${siteUrl(env)}/Html/compte.html#reset=${token}`); await sendMail(env, deps, email, subject, text); }
      catch (e) { return json(req, env, 502, { error: 'mail_failed' }); }
    }
    // Même réponse que l'adresse existe ou non.
    return json(req, env, 200, { ok: true });
  }

  if (m === 'POST' && p === '/auth/reset') {
    const { body, error } = await readJson(req, 2000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    if (await limitedDb(env, 'reset:' + ip, 10, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    const email = normEmail(body.email);
    if (!KEY_RE.test(body.key || '') || typeof body.token !== 'string') return json(req, env, 400, { error: 'invalid_request' });
    const row = await env.DB.prepare(
      'SELECT u.* FROM resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ?'
    ).bind(await sha256Hex(body.token), now).first();
    if (!row || row.email !== email) return json(req, env, 400, { error: 'invalid_token' });
    await env.DB.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').bind(await hashKey(body.key), row.id).run();
    await env.DB.prepare('DELETE FROM resets WHERE user_id = ?').bind(row.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id).run();
    const session = await createSession(env, row.id, now);
    return json(req, env, 200, { user: publicUser({ ...row, password_hash: 'x' }) }, { 'Set-Cookie': session });
  }

  if (m === 'POST' && p === '/auth/verify') {
    const { body, error } = await readJson(req, 1000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    if (await limitedDb(env, 'verify:' + ip, 20, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    if (typeof body.token !== 'string' || body.token.length > 100) return json(req, env, 400, { error: 'invalid_token' });
    const row = await env.DB.prepare(
      'SELECT u.* FROM verifications v JOIN users u ON u.id = v.user_id WHERE v.token_hash = ? AND v.expires_at > ?'
    ).bind(await sha256Hex(body.token), now).first();
    if (!row) return json(req, env, 400, { error: 'invalid_token' });
    await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(row.id).run();
    await env.DB.prepare('DELETE FROM verifications WHERE user_id = ?').bind(row.id).run();
    return json(req, env, 200, { ok: true, email: row.email });
  }

  // À partir d'ici, il faut être connecté.
  const user = await currentUser(req, env, now);
  if (!user) return json(req, env, 401, { error: 'unauthorized' });

  if (m === 'POST' && p === '/auth/password') {
    const { body, error } = await readJson(req, 2000);
    if (error) return json(req, env, error, { error: 'invalid_request' });
    if (await limitedDb(env, 'pwd:' + user.id, 10, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    if (!KEY_RE.test(body.key || '')) return json(req, env, 400, { error: 'invalid_key' });
    if (user.password_hash && !(await checkKey(user.password_hash, body.currentKey))) {
      return json(req, env, 401, { error: 'bad_credentials' });
    }
    await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashKey(body.key), user.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, user.th).run();
    return json(req, env, 200, { user: publicUser({ ...user, password_hash: 'x' }) });
  }

  if (m === 'POST' && p === '/auth/verify/resend') {
    if (user.email_verified) return json(req, env, 200, { ok: true, already: true });
    if (!mailsOn(env)) return json(req, env, 503, { error: 'mail_unavailable' });
    const { body } = await readJson(req, 500);
    if (await limitedDb(env, 'verifyresend:' + user.id, 3, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    try { await sendVerification(env, deps, user, body && body.lang, now); }
    catch (e) { return json(req, env, 502, { error: 'mail_failed' }); }
    return json(req, env, 200, { ok: true });
  }

  if (m === 'DELETE' && p === '/auth/me') {
    const { body, error } = await readJson(req, 1000);
    if (error || body.confirm !== true) return json(req, env, 400, { error: 'invalid_request' });
    if (await limitedDb(env, 'del:' + user.id, 10, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    // Confirmation : le mot de passe, ou l'adresse e-mail retapée pour un compte Google sans mot de passe.
    const ok = user.password_hash ? await checkKey(user.password_hash, body.key) : normEmail(body.email) === user.email;
    if (!ok) return json(req, env, 401, { error: 'bad_credentials' });
    await deleteUser(env, user.id);
    return json(req, env, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0) });
  }

  if (m === 'GET' && p === '/budget') {
    const row = await env.DB.prepare('SELECT data, updated_at FROM budgets WHERE user_id = ?').bind(user.id).first();
    return json(req, env, 200, row ? { data: JSON.parse(row.data), updated_at: row.updated_at } : { data: null, updated_at: 0 });
  }

  if (m === 'DELETE' && p === '/budget') {
    await env.DB.prepare('DELETE FROM budgets WHERE user_id = ?').bind(user.id).run();
    return json(req, env, 200, { ok: true });
  }

  if (m === 'PUT' && p === '/budget') {
    const { body, error } = await readJson(req, MAX_BUDGET_CHARS + 200);
    if (error) return json(req, env, error, { error: error === 413 ? 'payload_too_large' : 'invalid_request' });
    if (!body || typeof body.data !== 'object' || body.data === null || Array.isArray(body.data)) {
      return json(req, env, 400, { error: 'invalid_request' });
    }
    const data = JSON.stringify(body.data);
    if (data.length > MAX_BUDGET_CHARS) return json(req, env, 413, { error: 'payload_too_large' });
    const row = await env.DB.prepare('SELECT data, updated_at FROM budgets WHERE user_id = ?').bind(user.id).first();
    if (row && Number(body.base) !== row.updated_at) {
      return json(req, env, 409, { error: 'conflict', data: JSON.parse(row.data), updated_at: row.updated_at });
    }
    const updated = Math.max(now, row ? row.updated_at + 1 : 0);
    await env.DB.prepare(
      'INSERT INTO budgets (user_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at'
    ).bind(user.id, data, updated).run();
    return json(req, env, 200, { updated_at: updated });
  }

  return json(req, env, 404, { error: 'not_found' });
}

