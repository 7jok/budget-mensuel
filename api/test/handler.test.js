import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetLimits, buildMail } from '../src/handler.js';

const env = { ALLOWED_ORIGINS: 'https://exemple.ch', MAIL_FROM: 'formulaire@exemple.ch', MAIL_TO: 'moi@exemple.ch' };
const post = (body, origin = 'https://exemple.ch', ip = '1.1.1.1') => new Request('https://api.exemple.ch/contact', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'CF-Connecting-IP': ip }, body: JSON.stringify(body)
});
const good = { email: 'a@b.ch', subject: 'question', message: 'Bonjour, une question.', website: '', elapsed: 5000 };

test('envoie un message valide', async () => {
  resetLimits();
  const sent = [];
  const r = await handle(post(good), env, { send: async raw => sent.push(raw) });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Reply-To: <a@b\.ch>/);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://exemple.ch');
});

test('champ piège rempli : faux succès sans envoi', async () => {
  resetLimits();
  const sent = [];
  const r = await handle(post({ ...good, website: 'spam.com' }), env, { send: async raw => sent.push(raw) });
  assert.equal(r.status, 200);
  assert.equal(sent.length, 0);
});

test('envoi trop rapide ignoré', async () => {
  resetLimits();
  const sent = [];
  await handle(post({ ...good, elapsed: 500 }), env, { send: async raw => sent.push(raw) });
  assert.equal(sent.length, 0);
});

test('origine refusée', async () => {
  const r = await handle(post(good, 'https://pirate.example'), env, { send: async () => {} });
  assert.equal(r.status, 403);
});

test('e-mail avec retour à la ligne refusé (injection d\'en-tête)', async () => {
  resetLimits();
  const r = await handle(post({ ...good, email: 'a@b.ch\r\nBcc: x@y.z' }), env, { send: async () => {} });
  assert.equal(r.status, 400);
});

test('limite de 5 messages par heure', async () => {
  resetLimits();
  let last;
  for (let i = 0; i < 6; i++) last = await handle(post(good, undefined, '9.9.9.9'), env, { send: async () => {} });
  assert.equal(last.status, 429);
});

test('message trop court', async () => {
  resetLimits();
  const r = await handle(post({ ...good, message: 'court' }), env, { send: async () => {} });
  assert.equal(r.status, 400);
});

test('pays depuis Cloudflare', async () => {
  const req = new Request('https://api.exemple.ch/country');
  Object.defineProperty(req, 'cf', { value: { country: 'CH' } });
  const r = await handle(req, env, {});
  assert.deepEqual(await r.json(), { country: 'CH' });
});

test('taux : paramètre validé et réponse relayée', async () => {
  const bad = await handle(new Request('https://api.exemple.ch/rates?symbols=chf'), env, {});
  assert.equal(bad.status, 400);
  const fake = async () => new Response(JSON.stringify({ date: '2026-10-09', rates: { CHF: 0.93 } }));
  const r = await handle(new Request('https://api.exemple.ch/rates?symbols=CHF'), env, { fetch: fake });
  assert.deepEqual(await r.json(), { base: 'EUR', date: '2026-10-09', rates: { CHF: 0.93 } });
});

test('le mail encode le sujet en UTF-8', () => {
  const raw = buildMail(env, { email: 'a@b.ch', subject: 'probleme', message: 'Énoncé accentué' }, 0);
  assert.match(raw, /Subject: =\?UTF-8\?B\?/);
  assert.match(raw, /Message-ID: <.+@exemple\.ch>/);
});
