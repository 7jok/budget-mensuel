import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetLimits } from '../src/handler.js';
import { makeDB } from './d1mock.js';

const ORIGIN = 'https://exemple.ch';
const KEY1 = 'a'.repeat(64), KEY2 = 'b'.repeat(64), KEY3 = 'c'.repeat(64);

function setup(extra = {}) {
  resetLimits();
  return {
    ALLOWED_ORIGINS: ORIGIN, SITE_URL: 'https://exemple.ch', MAIL_FROM: 'f@exemple.ch',
    RESET_FROM: 'Budget <noreply@exemple.ch>', DB: makeDB(), ...extra
  };
}
function req(method, path, { body, cookie, origin = ORIGIN } = {}) {
  const h = { 'CF-Connecting-IP': '1.2.3.4' };
  if (origin) h.Origin = origin;
  if (cookie) h.Cookie = cookie;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  return new Request('https://api.exemple.ch' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
const sessionOf = r => (r.headers.getSetCookie().find(c => c.startsWith('bm_session=')) || '').split(';')[0];

test('inscription, session, doublon', async () => {
  const env = setup();
  const r = await handle(req('POST', '/auth/register', { body: { email: 'Jean@Exemple.ch', key: KEY1 } }), env, {});
  assert.equal(r.status, 201);
  const c = sessionOf(r);
  assert.match(c, /^bm_session=.{20,}/);
  assert.match(r.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(r.headers.get('Access-Control-Allow-Credentials'), 'true');
  const me = await handle(req('GET', '/auth/me', { cookie: c }), env, {});
  assert.equal((await me.json()).user.email, 'jean@exemple.ch');
  const dup = await handle(req('POST', '/auth/register', { body: { email: 'jean@exemple.ch', key: KEY2 } }), env, {});
  assert.equal(dup.status, 409);
});

test('clé invalide et origine refusée', async () => {
  const env = setup();
  assert.equal((await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: 'motdepasse' } }), env, {})).status, 400);
  assert.equal((await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 }, origin: 'https://pirate.example' }), env, {})).status, 403);
});

test('connexion, mauvais mot de passe, déconnexion', async () => {
  const env = setup();
  await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {});
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'a@b.ch', key: KEY2 } }), env, {})).status, 401);
  const ok = await handle(req('POST', '/auth/login', { body: { email: 'A@B.ch', key: KEY1 } }), env, {});
  assert.equal(ok.status, 200);
  const c = sessionOf(ok);
  await handle(req('POST', '/auth/logout', { body: {}, cookie: c }), env, {});
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: c }), env, {})).json()).user, null);
});

test('trop de tentatives de connexion', async () => {
  const env = setup();
  let last;
  for (let i = 0; i < 11; i++) last = await handle(req('POST', '/auth/login', { body: { email: 'x@y.ch', key: KEY1 } }), env, {});
  assert.equal(last.status, 429);
});

test('synchronisation du budget et conflit', async () => {
  const env = setup();
  const c = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {}));
  const empty = await (await handle(req('GET', '/budget', { cookie: c }), env, {})).json();
  assert.deepEqual(empty, { data: null, updated_at: 0 });
  const p1 = await handle(req('PUT', '/budget', { cookie: c, body: { data: { v: 2, x: 1 }, base: 0 } }), env, { now: () => 1000 });
  const u1 = (await p1.json()).updated_at;
  assert.equal(u1, 1000);
  const stale = await handle(req('PUT', '/budget', { cookie: c, body: { data: { v: 2, x: 2 }, base: 0 } }), env, { now: () => 2000 });
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).data, { v: 2, x: 1 });
  const p2 = await handle(req('PUT', '/budget', { cookie: c, body: { data: { v: 2, x: 3 }, base: u1 } }), env, { now: () => 3000 });
  assert.equal(p2.status, 200);
  const got = await (await handle(req('GET', '/budget', { cookie: c }), env, {})).json();
  assert.deepEqual(got, { data: { v: 2, x: 3 }, updated_at: 3000 });
  const big = await handle(req('PUT', '/budget', { cookie: c, body: { data: { s: 'x'.repeat(1_000_100) }, base: 3000 } }), env, {});
  assert.equal(big.status, 413);
  assert.equal((await handle(req('GET', '/budget'), env, {})).status, 401);
});

test('mot de passe oublié puis nouveau mot de passe', async () => {
  const sent = [];
  const fetch = async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return new Response('{}', { status: 200 }); };
  const noMail = setup();
  assert.equal((await handle(req('POST', '/auth/forgot', { body: { email: 'a@b.ch' } }), noMail, {})).status, 503);

  const env = setup({ RESEND_API_KEY: 're_test' });
  const old = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {}));
  const unknown = await handle(req('POST', '/auth/forgot', { body: { email: 'inconnu@b.ch' } }), env, { fetch });
  assert.equal(unknown.status, 200);
  assert.equal(sent.length, 0);
  assert.equal((await handle(req('POST', '/auth/forgot', { body: { email: 'a@b.ch', lang: 'fr' } }), env, { fetch })).status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://api.resend.com/emails');
  const token = sent[0].body.text.match(/#reset=([\w-]+)/)[1];
  assert.equal((await handle(req('POST', '/auth/reset', { body: { token, email: 'z@b.ch', key: KEY2 } }), env, {})).status, 400);
  const ok = await handle(req('POST', '/auth/reset', { body: { token, email: 'a@b.ch', key: KEY2 } }), env, {});
  assert.equal(ok.status, 200);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: old }), env, {})).json()).user, null);
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'a@b.ch', key: KEY2 } }), env, {})).status, 200);
  assert.equal((await handle(req('POST', '/auth/reset', { body: { token, email: 'a@b.ch', key: KEY3 } }), env, {})).status, 400);
});

test('changement de mot de passe', async () => {
  const env = setup();
  const c = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {}));
  assert.equal((await handle(req('POST', '/auth/password', { cookie: c, body: { currentKey: KEY3, key: KEY2 } }), env, {})).status, 401);
  assert.equal((await handle(req('POST', '/auth/password', { cookie: c, body: { currentKey: KEY1, key: KEY2 } }), env, {})).status, 200);
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'a@b.ch', key: KEY2 } }), env, {})).status, 200);
});

test('Google : création de compte et protection contre une inscription usurpée', async () => {
  const env = setup({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
  // Un tiers crée un compte avec l'adresse de la victime
  const intrus = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'victime@gmail.com', key: KEY1 } }), env, {}));
  const start = await handle(req('GET', '/auth/google/start', { origin: null }), env, {});
  assert.equal(start.status, 302);
  assert.match(start.headers.get('Location'), /^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
  const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', sub: 'g-123', email: 'Victime@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const fetch = async () => new Response(JSON.stringify({ id_token: `x.${payload}.y` }));
  const cb = await handle(req('GET', `/auth/google/callback?code=abc&state=${state}`, { origin: null, cookie: stateCookie }), env, { fetch });
  assert.equal(cb.status, 302);
  assert.equal(cb.headers.get('Location'), 'https://exemple.ch/Html/compte.html#google=ok');
  const c = sessionOf(cb);
  const me = await (await handle(req('GET', '/auth/me', { cookie: c }), env, {})).json();
  assert.deepEqual([me.user.email, me.user.google, me.user.password], ['victime@gmail.com', true, false]);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: intrus }), env, {})).json()).user, null);
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'victime@gmail.com', key: KEY1 } }), env, {})).status, 401);
  // Mauvais state
  const bad = await handle(req('GET', `/auth/google/callback?code=abc&state=autre`, { origin: null, cookie: stateCookie }), env, { fetch });
  assert.equal(bad.headers.get('Location'), 'https://exemple.ch/Html/compte.html#google=erreur');
});

test('Google non configuré renvoie vers le site', async () => {
  const env = setup();
  const r = await handle(req('GET', '/auth/google/start', { origin: null }), env, {});
  assert.equal(r.headers.get('Location'), 'https://exemple.ch/Html/compte.html#google=indisponible');
});

test('suppression du compte', async () => {
  const env = setup();
  const c = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {}));
  await handle(req('PUT', '/budget', { cookie: c, body: { data: { v: 2 }, base: 0 } }), env, {});
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: {} }), env, {})).status, 400);
  // Sans le mot de passe, ou avec un mauvais : refusé (une session volée ne suffit pas).
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: { confirm: true } }), env, {})).status, 401);
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: { confirm: true, key: KEY2 } }), env, {})).status, 401);
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: { confirm: true, key: KEY1 } }), env, {})).status, 200);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: c }), env, {})).json()).user, null);
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'a@b.ch', key: KEY1 } }), env, {})).status, 401);
  const again = await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY2 } }), env, {});
  assert.equal(again.status, 201);
});

test('comptes indisponibles sans base de données', async () => {
  resetLimits();
  const r = await handle(req('GET', '/auth/me'), { ALLOWED_ORIGINS: ORIGIN }, {});
  assert.equal(r.status, 503);
});

test('effacer le budget du compte', async () => {
  const env = setup();
  const c = sessionOf(await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, {}));
  await handle(req('PUT', '/budget', { cookie: c, body: { data: { v: 2 }, base: 0 } }), env, {});
  assert.equal((await handle(req('DELETE', '/budget', { cookie: c, body: { confirm: true } }), env, {})).status, 200);
  assert.deepEqual(await (await handle(req('GET', '/budget', { cookie: c }), env, {})).json(), { data: null, updated_at: 0 });
});

test('corps JSON null ou tableau : erreur 400 avec en-têtes CORS', async () => {
  const env = setup();
  for (const path of ['/auth/login', '/auth/register', '/auth/forgot', '/auth/reset', '/auth/verify']) {
    for (const raw of ['null', '[]', '5']) {
      const r = await handle(new Request('https://api.exemple.ch' + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: raw }), env, {});
      assert.equal(r.status, 400, path + ' ' + raw);
      assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    }
  }
});

test('confirmation de l\'adresse e-mail', async () => {
  const sent = [];
  const fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return new Response('{}'); };
  const env = setup({ RESEND_API_KEY: 'k' });
  const r = await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1, lang: 'en' } }), env, { fetch });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).verifySent, true);
  assert.match(sent[0].subject, /confirm/i);
  const token = /#verify=([\w-]+)/.exec(sent[0].text)[1];
  const c = sessionOf(r);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: c }), env, {})).json()).user.verified, false);
  assert.equal((await handle(req('POST', '/auth/verify', { body: { token: 'faux' } }), env, {})).status, 400);
  assert.equal((await handle(req('POST', '/auth/verify', { body: { token } }), env, {})).status, 200);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: c }), env, {})).json()).user.verified, true);
  assert.equal((await handle(req('POST', '/auth/verify', { body: { token } }), env, {})).status, 400);
  // Sans service d'e-mail, l'inscription fonctionne quand même.
  const env2 = setup();
  const r2 = await handle(req('POST', '/auth/register', { body: { email: 'c@d.ch', key: KEY1 } }), env2, {});
  assert.equal(r2.status, 201);
  assert.equal((await r2.json()).verifySent, false);
});

test('suppression d\'un compte Google : adresse retapée', async () => {
  const env = setup({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' });
  const start = await handle(req('GET', '/auth/google/start', { origin: null }), env, {});
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const payload = Buffer.from(JSON.stringify({ iss: 'https://accounts.google.com', aud: 'cid', sub: 'g-9', email: 'g@gmail.com', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const cb = await handle(req('GET', `/auth/google/callback?code=x&state=${state}`, { origin: null, cookie: start.headers.getSetCookie()[0].split(';')[0] }), env, { fetch: async () => new Response(JSON.stringify({ id_token: `x.${payload}.y` })) });
  const c = sessionOf(cb);
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: { confirm: true, email: 'autre@gmail.com' } }), env, {})).status, 401);
  assert.equal((await handle(req('DELETE', '/auth/me', { cookie: c, body: { confirm: true, email: 'G@gmail.com' } }), env, {})).status, 200);
});

test('limites partagées entre instances (gardées dans la base)', async () => {
  const env = setup();
  let last;
  for (let i = 0; i < 11; i++) {
    resetLimits(); // simule une nouvelle instance du Worker à chaque requête
    last = await handle(req('POST', '/auth/login', { body: { email: 'x@y.ch', key: KEY1 } }), env, {});
  }
  assert.equal(last.status, 429);
});

test('nettoyage nocturne : expirés et comptes inactifs', async () => {
  const { cleanup } = await import('../src/auth.js');
  const sent = [];
  const fetch = async (url, o) => { sent.push(JSON.parse(o.body)); return new Response('{}'); };
  const env = setup({ RESEND_API_KEY: 'k' });
  const DAY = 86400000, t0 = Date.now();
  const r = await handle(req('POST', '/auth/register', { body: { email: 'vieux@b.ch', key: KEY1 } }), env, { fetch, now: () => t0 });
  const c = sessionOf(r);
  await handle(req('POST', '/auth/register', { body: { email: 'actif@b.ch', key: KEY1 } }), env, { fetch, now: () => t0 + 690 * DAY });
  // 701 jours plus tard : avertissement, sessions expirées effacées
  let out = await cleanup(env, { fetch }, t0 + 701 * DAY);
  assert.deepEqual(out, { warned: 1, deleted: 0 });
  assert.match(sent.at(-1).subject, /30 jours/);
  assert.equal((await (await handle(req('GET', '/auth/me', { cookie: c }), env, { now: () => t0 + 701 * DAY })).json()).user, null);
  // Pas de 2e avertissement, pas encore de suppression
  out = await cleanup(env, { fetch }, t0 + 720 * DAY);
  assert.deepEqual(out, { warned: 0, deleted: 0 });
  // 24 mois et 30 jours après l'avertissement : suppression
  out = await cleanup(env, { fetch }, t0 + 732 * DAY);
  assert.deepEqual(out, { warned: 0, deleted: 1 });
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'vieux@b.ch', key: KEY1 } }), env, { now: () => t0 + 732 * DAY })).status, 401);
  assert.equal((await handle(req('POST', '/auth/login', { body: { email: 'actif@b.ch', key: KEY1 } }), env, { now: () => t0 + 732 * DAY })).status, 200);
});

test('une connexion annule l\'avertissement d\'inactivité', async () => {
  const { cleanup } = await import('../src/auth.js');
  const fetch = async () => new Response('{}');
  const env = setup({ RESEND_API_KEY: 'k' });
  const DAY = 86400000, t0 = Date.now();
  await handle(req('POST', '/auth/register', { body: { email: 'a@b.ch', key: KEY1 } }), env, { fetch, now: () => t0 });
  await cleanup(env, { fetch }, t0 + 701 * DAY);
  await handle(req('POST', '/auth/login', { body: { email: 'a@b.ch', key: KEY1 } }), env, { now: () => t0 + 710 * DAY });
  assert.deepEqual(await cleanup(env, { fetch }, t0 + 745 * DAY), { warned: 0, deleted: 0 });
});
