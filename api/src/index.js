import { EmailMessage } from 'cloudflare:email';
import { handle } from './handler.js';
import { cleanup } from './auth.js';

export default {
  fetch(req, env) {
    return handle(req, env, {
      send: raw => env.MAILER.send(new EmailMessage(env.MAIL_FROM, env.MAIL_TO, raw))
    });
  },
  // Chaque nuit : effacement des sessions, liens et compteurs expirés, et des comptes inactifs depuis 24 mois.
  scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env, {}, Date.now()));
  }
};
