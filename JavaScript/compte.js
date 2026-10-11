/* Page Compte : inscription, connexion (e-mail ou Google), mot de passe oublié,
   changement de mot de passe, déconnexion et suppression du compte.
   Le mot de passe ne quitte jamais le navigateur : on envoie une clé dérivée (PBKDF2). */
(function () {
  'use strict';
  var I = window.I18N, t = I.t;
  var API = window.siteSetting ? window.siteSetting('API_URL') : '';
  var $ = function (id) { return document.getElementById(id); };
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
  var views = ['view-out', 'view-forgot', 'view-reset', 'view-in', 'view-off'];
  var user = null;
  var resetToken = null;
  var mode = 'login';

  function show(id) { views.forEach(function (v) { $(v).hidden = v !== id; }); }
  function msg(key, vars) { $('acc-msg').textContent = key ? t(key, vars) : ''; }

  function call(method, path, body) {
    return fetch(API + path, {
      method: method, credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, body: j }; });
    });
  }
  function fail(res) {
    var code = res && res.body && res.body.error;
    var known = ['invalid_email', 'exists', 'exists_google', 'bad_credentials', 'too_many', 'invalid_token', 'reset_unavailable', 'mail_failed', 'mail_unavailable'];
    msg(known.indexOf(code) !== -1 ? 'acc.err.' + code : 'acc.err.generic');
  }
  function network() { msg('acc.err.network'); }

  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join(''); }
  function deriveKey(email, password) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveBits'])
      .then(function (base) {
        return crypto.subtle.deriveBits({
          name: 'PBKDF2', hash: 'SHA-256', iterations: 600000,
          salt: enc.encode('budget-mensuel.ch|' + email.trim().toLowerCase())
        }, base, 256);
      }).then(hex);
  }

  function busy(form, on) {
    var b = form.querySelectorAll('button[type=submit]');
    for (var i = 0; i < b.length; i++) b[i].disabled = on;
  }
  function checkEmail(v) {
    if (!EMAIL_RE.test(v.trim())) { msg('acc.err.invalid_email'); return false; }
    return true;
  }
  function checkPwd(p1, p2) {
    if (p1.length < 10) { msg('acc.err.short'); return false; }
    if (p2 !== null && p1 !== p2) { msg('acc.err.mismatch'); return false; }
    return true;
  }

  /* Après connexion : la synchronisation se fait sur la page du budget. */
  function signedIn(u, key) {
    user = u;
    try {
      var meta = JSON.parse(localStorage.getItem('budget-mensuel-sync') || 'null');
      if (!meta || meta.email !== u.email) localStorage.setItem('budget-mensuel-sync', JSON.stringify({ email: u.email, syncedAt: 0, dirty: true, linking: true }));
    } catch (e) { /* ignoré */ }
    renderIn();
    if (key) msg(key);
  }

  function renderIn() {
    show('view-in');
    $('in-email').textContent = t('acc.in.email', { email: user.email });
    var m = [];
    if (user.google) m.push(t('acc.method.google'));
    if (user.password) m.push(t('acc.method.password'));
    $('in-methods').textContent = t('acc.in.methods', { methods: m.join(', ') });
    $('p-current-wrap').hidden = !user.password;
    $('pwd-info').textContent = user.password ? '' : t('acc.pwd.set');
    $('verify-box').hidden = user.verified !== false;
    // Suppression : le mot de passe, ou l'adresse retapée pour un compte Google sans mot de passe.
    $('del-pwd-label').textContent = t(user.password ? 'acc.del.pwd' : 'acc.del.email');
    $('del-pwd').type = user.password ? 'password' : 'email';
    $('del-pwd').setAttribute('autocomplete', user.password ? 'current-password' : 'off');
  }

  function setMode(m) {
    mode = m;
    $('tab-login').setAttribute('aria-selected', m === 'login');
    $('tab-register').setAttribute('aria-selected', m === 'register');
    $('a-pwd2-wrap').hidden = m !== 'register';
    $('a-age').hidden = m !== 'register';
    $('submit-login').hidden = m !== 'login';
    $('submit-register').hidden = m !== 'register';
    $('a-pwd').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    msg('');
  }
  $('tab-login').addEventListener('click', function () { setMode('login'); });
  $('tab-register').addEventListener('click', function () { setMode('register'); });

  $('auth-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('a-email').value.trim(), pwd = $('a-pwd').value;
    if (!checkEmail(email) || !checkPwd(pwd, mode === 'register' ? $('a-pwd2').value : null)) return;
    var form = e.target;
    busy(form, true);
    msg('acc.working');
    deriveKey(email, pwd).then(function (key) {
      return call('POST', mode === 'login' ? '/auth/login' : '/auth/register', { email: email, key: key, lang: I.lang });
    }).then(function (res) {
      busy(form, false);
      if (!res.ok) return fail(res);
      $('a-pwd').value = ''; $('a-pwd2').value = '';
      signedIn(res.body.user, '');
      location.href = '../index.html';
    }).catch(function () { busy(form, false); network(); });
  });

  $('google-btn').addEventListener('click', function (e) {
    e.preventDefault();
    location.href = API + '/auth/google/start';
  });

  $('forgot-open').addEventListener('click', function () {
    $('f-email').value = $('a-email').value;
    msg('');
    show('view-forgot');
    $('f-email').focus();
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-back]')) { msg(''); show('view-out'); }
  });

  $('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('f-email').value.trim();
    if (!checkEmail(email)) return;
    var form = e.target;
    busy(form, true);
    call('POST', '/auth/forgot', { email: email, lang: I.lang }).then(function (res) {
      busy(form, false);
      if (!res.ok) return fail(res);
      msg('acc.forgot.sent');
    }).catch(function () { busy(form, false); network(); });
  });

  $('reset-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('r-email').value.trim(), pwd = $('r-pwd').value;
    if (!checkEmail(email) || !checkPwd(pwd, $('r-pwd2').value)) return;
    var form = e.target;
    busy(form, true);
    msg('acc.working');
    deriveKey(email, pwd).then(function (key) {
      return call('POST', '/auth/reset', { token: resetToken, email: email, key: key });
    }).then(function (res) {
      busy(form, false);
      if (!res.ok) return fail(res);
      history.replaceState(null, '', location.pathname);
      signedIn(res.body.user, 'acc.reset.done');
    }).catch(function () { busy(form, false); network(); });
  });

  $('pwd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var pwd = $('p-new').value;
    if (!checkPwd(pwd, $('p-new2').value)) return;
    var form = e.target;
    busy(form, true);
    msg('acc.working');
    var current = user.password ? deriveKey(user.email, $('p-current').value) : Promise.resolve(undefined);
    Promise.all([current, deriveKey(user.email, pwd)]).then(function (keys) {
      return call('POST', '/auth/password', { currentKey: keys[0], key: keys[1] });
    }).then(function (res) {
      busy(form, false);
      if (!res.ok) return fail(res);
      $('p-current').value = ''; $('p-new').value = ''; $('p-new2').value = '';
      user = res.body.user;
      renderIn();
      msg('acc.pwd.done');
    }).catch(function () { busy(form, false); network(); });
  });

  $('logout').addEventListener('click', function () {
    var wipe = confirm(t('acc.logout.confirm'));
    call('POST', '/auth/logout', {}).catch(function () { return null; }).then(function () {
      try {
        localStorage.removeItem('budget-mensuel-sync');
        if (wipe) { ['budget-mensuel-v2', 'budget-mensuel-v1', 'budget-mensuel-versions'].forEach(function (k) { localStorage.removeItem(k); }); }
      } catch (e) { /* ignoré */ }
      user = null;
      setMode('login');
      show('view-out');
    });
  });

  $('verify-resend').addEventListener('click', function () {
    var b = this;
    b.disabled = true;
    call('POST', '/auth/verify/resend', { lang: I.lang }).then(function (res) {
      b.disabled = false;
      if (!res.ok) return fail(res);
      msg(res.body.already ? 'acc.verify.done' : 'acc.verify.sent');
    }).catch(function () { b.disabled = false; network(); });
  });

  $('del-account').addEventListener('click', function () {
    var value = $('del-pwd').value.trim();
    if (!value) { msg(user.password ? 'acc.del.needPwd' : 'acc.del.needEmail'); $('del-pwd').focus(); return; }
    if (!$('del-check').checked) { msg('acc.del.needCheck'); return; }
    if (!confirm(t('acc.del.confirm'))) return;
    msg('acc.working');
    var body = user.password
      ? deriveKey(user.email, $('del-pwd').value).then(function (key) { return { confirm: true, key: key }; })
      : Promise.resolve({ confirm: true, email: value });
    body.then(function (b) { return call('DELETE', '/auth/me', b); }).then(function (res) {
      if (!res.ok) return res.body && res.body.error === 'bad_credentials' ? msg(user.password ? 'acc.del.badPwd' : 'acc.del.badEmail') : fail(res);
      $('del-pwd').value = '';
      try { localStorage.removeItem('budget-mensuel-sync'); } catch (e) { /* ignoré */ }
      user = null;
      setMode('login');
      show('view-out');
      msg('acc.del.done');
    }).catch(network);
  });

  document.addEventListener('langchange', function () { if (user) renderIn(); });

  /* ---------- Démarrage ---------- */
  if (!API) { show('view-off'); return; }

  function start() {
    var hash = location.hash;
    var g = /^#google=(ok|erreur|indisponible)$/.exec(hash);
    var r = /^#reset=([\w-]{20,})$/.exec(hash);
    var v = /^#verify=([\w-]{20,})$/.exec(hash);
    if (v) {
      history.replaceState(null, '', location.pathname);
      call('POST', '/auth/verify', { token: v[1] }).then(function (res) {
        checkSession(null, res.ok ? 'acc.verify.done' : 'acc.err.invalid_token');
      }).catch(function () { checkSession(null); network(); });
      return;
    }
    if (r) {
      resetToken = r[1];
      msg('');
      show('view-reset');
      $('r-email').focus();
      return;
    }
    checkSession(g);
  }
  window.addEventListener('hashchange', start);
  start();

  function checkSession(g, note) {
  call('GET', '/auth/me').then(function (res) {
    if (res.status === 503) { show('view-off'); return; }
    if (res.ok && res.body.user) {
      signedIn(res.body.user, g ? 'acc.google.' + g[1] : (note || ''));
      if (g) history.replaceState(null, '', location.pathname);
      return;
    }
    setMode('login');
    show('view-out');
    if (note) msg(note);
    if (g) { msg('acc.google.' + g[1]); history.replaceState(null, '', location.pathname); }
  }).catch(function () { setMode('login'); show('view-out'); network(); });
  }
})();
