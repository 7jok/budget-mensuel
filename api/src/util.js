// Outils communs à l'API : en-têtes, réponses JSON, cookies, limites d'envoi, hachage.

export function origins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

export function allowedOrigin(req, env) {
  const origin = req.headers.get('Origin');
  return origin && origins(env).includes(origin) ? origin : null;
}

export function headers(req, env, extra) {
  const h = new Headers(extra || {});
  const origin = allowedOrigin(req, env);
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Vary', 'Origin');
  }
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return h;
}

export function json(req, env, status, body, extra) {
  const h = headers(req, env, extra);
  h.set('Content-Type', 'application/json; charset=utf-8');
  if (!h.has('Cache-Control')) h.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}

// Limite simple en mémoire (par instance du Worker). Suffisante pour un petit site.
const buckets = new Map();
export function limited(key, max, windowMs, now) {
  const list = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (list.length >= max) { buckets.set(key, list); return true; }
  list.push(now);
  buckets.set(key, list);
  if (buckets.size > 10000) buckets.clear();
  return false;
}
export function resetLimits() { buckets.clear(); }

// Limite partagée entre toutes les instances du Worker, gardée dans D1.
// La clé est hachée : ni l'adresse IP ni l'e-mail ne sont stockés en clair.
export async function limitedDb(env, key, max, windowMs, now) {
  if (!env.DB) return limited(key, max, windowMs, now);
  const k = await sha256Hex('limit|' + key);
  const row = await env.DB.prepare(
    'INSERT INTO limits (k, n, reset_at) VALUES (?, 1, ?) ' +
    'ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset_at <= ? THEN 1 ELSE n + 1 END, ' +
    'reset_at = CASE WHEN reset_at <= ? THEN ? ELSE reset_at END RETURNING n'
  ).bind(k, now + windowMs, now, now, now + windowMs).first();
  return !!row && row.n > max;
}

export function readCookie(req, name) {
  const raw = req.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function cookie(name, value, maxAge, path = '/') {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function randomToken(n = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}

export function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export function fromHex(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function readJson(req, maxBytes) {
  if (!(req.headers.get('Content-Type') || '').startsWith('application/json')) return { error: 415 };
  const raw = await req.text();
  if (raw.length > maxBytes) return { error: 413 };
  let body;
  try { body = JSON.parse(raw); } catch (e) { return { error: 400 }; }
  // Le corps doit être un objet : « null », un nombre ou un tableau sont refusés.
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 400 };
  return { body };
}

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
