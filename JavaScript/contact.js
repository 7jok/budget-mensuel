/* Formulaire de contact : validation dans le navigateur, puis envoi à l'API
   qui refait toutes les vérifications (champ piège, délai minimal, limite d'envois). */
(function () {
  'use strict';
  var form = document.getElementById('contact-form');
  if (!form) return;
  var t = window.I18N.t;
  var started = Date.now();
  var status = document.getElementById('form-status');
  var email = document.getElementById('c-email');
  var message = document.getElementById('c-message');
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

  /* Message d'état, avec si besoin l'adresse e-mail directe du site. */
  function say(key, withMail) {
    status.textContent = t(key) + (withMail ? ' ' : '');
    if (withMail) {
      var mail = 'aide@budget-mensuel.ch';
      status.appendChild(document.createTextNode(t('ct.direct') + ' '));
      var a = document.createElement('a');
      a.href = 'mailto:' + mail;
      a.textContent = mail;
      status.appendChild(a);
      status.appendChild(document.createTextNode('.'));
    }
  }
  function setError(input, text) {
    var box = document.getElementById(input.id + '-err');
    box.textContent = text;
    if (text) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
    return !text;
  }
  function checkEmail() {
    var v = email.value.trim();
    if (!v) return setError(email, t('ct.err.email'));
    if (v.length > 254 || !EMAIL_RE.test(v)) return setError(email, t('ct.err.emailInvalid'));
    return setError(email, '');
  }
  function checkMessage() {
    var n = message.value.trim().length;
    if (n < 10) return setError(message, t('ct.err.short'));
    if (n > 3000) return setError(message, t('ct.err.long', { n: n }));
    return setError(message, '');
  }
  email.addEventListener('blur', function () { if (email.value) checkEmail(); });
  message.addEventListener('blur', function () { if (message.value) checkMessage(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.textContent = '';
    var ok = checkEmail() & checkMessage();
    if (!ok) {
      (email.getAttribute('aria-invalid') ? email : message).focus();
      return;
    }
    if (Date.now() - started < 3000) { status.textContent = t('ct.wait'); return; }
    var api = window.siteSetting ? window.siteSetting('API_URL') : '';
    if (!api) { say('ct.off', true); return; }
    var button = form.querySelector('button[type=submit]');
    button.disabled = true;
    status.textContent = t('ct.sending');
    fetch(api + '/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: email.value.trim(),
        subject: form.subject.value,
        message: message.value.trim(),
        website: form.website.value,
        elapsed: Date.now() - started
      })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        var code = j && j.error;
        if (r.ok) { form.reset(); status.textContent = t('ct.sent'); return; }
        // Un message précis pour chaque cas, et l'adresse directe quand l'envoi échoue côté serveur.
        if (r.status === 429) return say('ct.tooMany', true);
        if (code === 'invalid_email') { setError(email, t('ct.err.emailInvalid')); email.focus(); return say('ct.fix'); }
        if (code === 'invalid_message' || r.status === 413) { checkMessage(); message.focus(); return say('ct.fix'); }
        if (code === 'too_many_links') return say('ct.err.links');
        if (code === 'invalid_subject' || code === 'invalid_request') return say('ct.err.request', true);
        say('ct.failed', true);
      });
    }).catch(function () {
      say('ct.network', true);
    }).finally(function () {
      button.disabled = false;
    });
  });
})();
