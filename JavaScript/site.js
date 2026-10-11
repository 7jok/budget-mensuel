/* Commun à toutes les pages : passage en HTTPS, bandeau cookies (FR/EN),
   mesure d'audience chargée uniquement après accord, choix du thème. */
(function () {
  'use strict';

  var host = location.hostname;
  var local = host === '' || host === 'localhost' || host === '127.0.0.1';
  if (location.protocol === 'http:' && !local) {
    location.replace('https:' + location.href.slice(5));
    return;
  }

  // Le site ne doit pas être affiché dans le cadre d'un autre site (protection contre le détournement de clics).
  if (window.top !== window.self) {
    try { window.top.location = window.location.href; } catch (e) { document.documentElement.style.display = 'none'; }
  }

  var cfg = window.SITE_CONFIG || {};
  function setting(name) {
    var v = cfg[name];
    return v && v.indexOf('{{') === -1 ? v : '';
  }
  window.siteSetting = setting;

  var script = document.currentScript;
  var base = script ? script.src.replace(/JavaScript\/site\.js.*$/, '') : '/';
  var KEY = 'budget-mensuel-consent';
  var THEME_KEY = 'bm-theme';
  var SIX_MONTHS = 183 * 24 * 3600 * 1000;

  var TXT = {
    fr: {
      label: 'Choix concernant les cookies',
      text: '<strong>Cookies et mesure d\'audience.</strong> Ce site ne dépose aucun cookie publicitaire. ' +
        'Avec votre accord, il compte les visites (page vue, pays, type d\'appareil) avec Cloudflare Web Analytics, sans cookie. ' +
        'Votre budget n\'est jamais concerné. ',
      link: 'Politique de cookies', href: 'Html/cookies.html', no: 'Refuser', yes: 'Accepter',
      theme: 'Thème : ', auto: 'auto', light: 'clair', dark: 'sombre'
    },
    en: {
      label: 'Cookie choices',
      text: '<strong>Cookies and visitor statistics.</strong> This site sets no advertising cookies. ' +
        'With your consent, it counts visits (page viewed, country, device type) with Cloudflare Web Analytics, without cookies. ' +
        'Your budget is never involved. ',
      link: 'Cookie policy', href: 'Html/en/cookies.html', no: 'Decline', yes: 'Accept',
      theme: 'Theme: ', auto: 'auto', light: 'light', dark: 'dark'
    },
    de: {
      label: 'Auswahl zu Cookies',
      text: '<strong>Cookies und Besucherstatistik.</strong> Diese Seite setzt keine Werbe-Cookies. ' +
        'Mit Ihrer Zustimmung zählt sie die Besuche (aufgerufene Seite, Land, Gerätetyp) mit Cloudflare Web Analytics, ohne Cookies. ' +
        'Ihr Budget ist nie betroffen. ',
      link: 'Cookie-Richtlinie', href: 'Html/de/cookies.html', no: 'Ablehnen', yes: 'Akzeptieren',
      theme: 'Design: ', auto: 'automatisch', light: 'hell', dark: 'dunkel'
    }
  };
  function lang() { var l = document.documentElement.lang; return TXT[l] ? l : 'fr'; }
  function tx() { return TXT[lang()]; }

  function readChoice() {
    try {
      var c = JSON.parse(localStorage.getItem(KEY));
      if (c && (c.v === 'oui' || c.v === 'non') && Date.now() - c.d < SIX_MONTHS) return c.v;
    } catch (e) { /* stockage indisponible */ }
    return null;
  }
  function writeChoice(v) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: v, d: Date.now() })); } catch (e) { /* ignoré */ }
  }

  var analyticsLoaded = false;
  function loadAnalytics() {
    var token = setting('CF_ANALYTICS_TOKEN');
    if (!token || analyticsLoaded) return;
    analyticsLoaded = true;
    var s = document.createElement('script');
    s.defer = true;
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: token, spa: false }));
    document.head.appendChild(s);
  }

  var banner;
  function fillBanner() {
    var x = tx();
    banner.setAttribute('aria-label', x.label);
    banner.innerHTML =
      '<p>' + x.text + '<a href="' + base + x.href + '">' + x.link + '</a></p>' +
      '<div class="cookie-actions">' +
      '<button type="button" data-choice="non">' + x.no + '</button>' +
      '<button type="button" data-choice="oui">' + x.yes + '</button>' +
      '</div>';
  }
  function buildBanner() {
    banner = document.createElement('section');
    banner.className = 'cookie-banner';
    fillBanner();
    banner.addEventListener('click', function (e) {
      var v = e.target.getAttribute('data-choice');
      if (!v) return;
      var before = readChoice();
      writeChoice(v);
      banner.hidden = true;
      makeRoom();
      if (v === 'oui') loadAnalytics();
      else if (before === 'oui' && analyticsLoaded) location.reload();
    });
    document.body.appendChild(banner);
  }
  /* La page garde de la place en bas pour que le bandeau ne cache jamais rien. */
  function makeRoom() {
    document.body.style.paddingBottom = banner && !banner.hidden ? banner.offsetHeight + 'px' : '';
  }
  window.addEventListener('resize', function () { if (banner && !banner.hidden) makeRoom(); });
  function openBanner(focus) {
    if (!banner) buildBanner();
    banner.hidden = false;
    makeRoom();
    if (focus) { var b = banner.querySelector('button'); if (b) b.focus(); }
  }

  /* Thème : auto (réglage de l'appareil), clair ou sombre */
  function getTheme() {
    try { var t = localStorage.getItem(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; } catch (e) { return 'auto'; }
  }
  function setTheme(t) {
    if (t !== 'light' && t !== 'dark') t = 'auto';
    try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignoré */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
    labelThemeButtons();
    document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
  }
  function labelThemeButtons() {
    var x = tx(), t = getTheme();
    var b = document.querySelectorAll('[data-theme-cycle]');
    for (var i = 0; i < b.length; i++) b[i].textContent = x.theme + x[t];
  }
  window.BMTheme = { get: getTheme, set: setTheme };

  function init() {
    var choice = readChoice();
    if (choice === 'oui') loadAnalytics();
    if (!choice) openBanner(false);
    document.addEventListener('click', function (e) {
      var el = e.target.closest ? e.target.closest('[data-cookies],[data-theme-cycle],[data-lang-link]') : null;
      if (!el) return;
      if (el.hasAttribute('data-cookies')) openBanner(true);
      else if (el.hasAttribute('data-theme-cycle')) {
        var order = ['auto', 'light', 'dark'];
        setTheme(order[(order.indexOf(getTheme()) + 1) % 3]);
      } else if (el.hasAttribute('data-lang-link')) {
        try { localStorage.setItem('bm-lang', el.getAttribute('data-lang-link')); } catch (err) { /* ignoré */ }
      }
    });
    labelThemeButtons();
    document.addEventListener('langchange', function () {
      if (banner) { fillBanner(); makeRoom(); }
      labelThemeButtons();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Application installable et utilisable hors ligne (uniquement sur le vrai domaine).
  if ('serviceWorker' in navigator && /(^|\.)budget-mensuel\.ch$/.test(host) && !window.BM_NO_SW) {
    window.addEventListener('load', function () { navigator.serviceWorker.register(base + 'sw.js').catch(function () { /* ignoré */ }); });
  }
})();
