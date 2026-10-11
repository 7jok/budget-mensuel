// API de Budget mensuel, séparée du site.
// GET  /country           -> pays du visiteur (code ISO), déduit par Cloudflare, rien n'est enregistré
// GET  /rates?symbols=... -> taux de référence BCE (base EUR), mis en cache 6 heures
// POST /contact           -> vérifie le message (anti-spam) et l'envoie par e-mail
// /auth/... et /budget    -> comptes et synchronisation (voir auth.js)

import { json, headers, allowedOrigin, limitedDb, resetLimits, EMAIL_RE } from './util.js';
import { handleAuth } from './auth.js';

const SUBJECTS = {
  question: "Question sur l'utilisation",
  probleme: 'Problème sur le site',
  suggestion: 'Suggestion',
  donnees: 'Données personnelles'
};
const MIN_ELAPSED_MS = 3000;

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildMail(env, data, now) {
  const domain = String(env.MAIL_FROM || '').split('@')[1] || 'localhost';
  const subject = `[Budget mensuel] ${SUBJECTS[data.subject]}`;
  const body = `Message reçu depuis le formulaire de contact.\n\nDe : ${data.email}\nSujet : ${SUBJECTS[data.subject]}\n\n${data.message}\n`;
  const lines = [
    `From: Budget mensuel <${env.MAIL_FROM}>`,
    `To: <${env.MAIL_TO}>`,
    `Reply-To: <${data.email}>`,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body).replace(/.{76}/g, '$&\r\n')
  ];
  return lines.join('\r\n');
}

export function validate(input) {
  if (!input || typeof input !== 'object') return { error: 'invalid_request' };
  const email = typeof input.email === 'string' ? input.email.trim() : '';
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject : '';
  if (typeof input.website === 'string' && input.website !== '') return { spam: true };
  if (!(Number(input.elapsed) >= MIN_ELAPSED_MS)) return { spam: true };
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || /[\r\n]/.test(email)) return { error: 'invalid_email' };
  if (!Object.prototype.hasOwnProperty.call(SUBJECTS, subject)) return { error: 'invalid_subject' };
  if (message.length < 10 || message.length > 3000) return { error: 'invalid_message' };
  if ((message.match(/https?:\/\//gi) || []).length > 3) return { error: 'too_many_links' };
  return { data: { email, subject, message } };
}

export async function handle(req, env, deps) {
  const url = new URL(req.url);
  const now = deps.now ? deps.now() : Date.now();

  if (req.method === 'OPTIONS') {
    const h = headers(req, env);
    h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    h.set('Access-Control-Allow-Headers', 'Content-Type');
    h.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers: h });
  }

  if (req.method === 'GET' && url.pathname === '/country') {
    const cc = req.cf && typeof req.cf.country === 'string' ? req.cf.country : null;
    return json(req, env, 200, { country: cc }, { 'Cache-Control': 'private, no-store' });
  }

  if (req.method === 'GET' && url.pathname === '/rates') {
    const symbols = (url.searchParams.get('symbols') || '').split(',').filter(Boolean);
    if (!symbols.length || symbols.length > 20 || !symbols.every(s => /^[A-Z]{3}$/.test(s))) {
      return json(req, env, 400, { error: 'invalid_request' });
    }
    try {
      const fetcher = deps.fetch || fetch;
      const r = await fetcher(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols.sort().join(',')}`, {
        cf: { cacheTtl: 21600, cacheEverything: true }
      });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      return json(req, env, 200, { base: 'EUR', date: j.date, rates: j.rates || {} }, { 'Cache-Control': 'public, max-age=3600' });
    } catch (e) {
      return json(req, env, 502, { error: 'rates_unavailable' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/contact') {
    if (!allowedOrigin(req, env)) return json(req, env, 403, { error: 'forbidden_origin' });
    if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) return json(req, env, 415, { error: 'invalid_request' });
    const raw = await req.text();
    if (raw.length > 10000) return json(req, env, 413, { error: 'invalid_message' });
    let input;
    try { input = JSON.parse(raw); } catch (e) { return json(req, env, 400, { error: 'invalid_request' }); }
    const ip = req.headers.get('CF-Connecting-IP') || 'inconnu';
    if (await limitedDb(env, 'contact:' + ip, 5, 3600000, now)) return json(req, env, 429, { error: 'too_many' });
    const v = validate(input);
    if (v.spam) return json(req, env, 200, { ok: true });
    if (v.error) return json(req, env, 400, { error: v.error });
    try {
      await deps.send(buildMail(env, v.data, now));
      return json(req, env, 200, { ok: true });
    } catch (e) {
      return json(req, env, 500, { error: 'mail_failed' });
    }
  }

  const auth = await handleAuth(req, env, deps, url, now);
  if (auth) return auth;

  return json(req, env, 404, { error: 'not_found' });
}

export { resetLimits };
