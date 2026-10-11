/* Budget mensuel.
   Sans compte : tout reste dans le navigateur (localStorage).
   Avec un compte : une copie est synchronisée avec l'API (api.budget-mensuel.ch). */
(function () {
  'use strict';

  var C = window.BUDGET_COUNTRIES;
  var CURRENCIES = window.BUDGET_CURRENCIES;
  var ECB = window.BUDGET_ECB;
  var I = window.I18N;
  var t = I.t;
  var KEY = 'budget-mensuel-v2';
  var OLD_KEY = 'budget-mensuel-v1';
  var SYNC_KEY = 'budget-mensuel-sync';
  var VERSIONS_KEY = 'budget-mensuel-versions';
  var FOLD_KEY = 'bm-folded';
  var XOF_PER_EUR = 655.957;
  var LOG_MAX = 300;
  var MAX_AMOUNT = 10000000;
  var CUR_RE = /^[A-Z]{3}$/;
  var MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  var PILLAR3A_MAX = { withLpp: 7258, withoutLpp: 36288 };   // plafonds 2025 et 2026 (OFAS)
  var setting = window.siteSetting || function () { return ''; };
  var API = setting('API_URL');

  var OUT_CATS = ['Logement', 'Courses et ménage', 'Transports', 'Véhicule', 'Santé et assurances',
    'Téléphone et internet', 'Abonnements', 'Loisirs et sorties', 'Enfants', 'Impôts', 'Épargne',
    'Remboursement de dette', 'Dons', 'Frais bancaires', 'Divers', 'Virement interne'];
  var IN_CATS = ['Salaire', 'Allocations', 'Pension ou rente', 'Revenu indépendant', 'Autre revenu', 'Virement interne'];
  var INTERNAL = 'Virement interne';

  var $ = function (id) { return document.getElementById(id); };
  var storageOK = true;
  var S = load();
  var ratesFetched = false;
  var logShown = 30;

  /* ---------- Contrôle et réparation des données ---------- */

  function isObj(o) { return !!o && typeof o === 'object' && !Array.isArray(o); }
  function str(v, max) { return (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max); }
  function amt(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? Math.min(MAX_AMOUNT, Math.max(0, Math.round(n * 100) / 100)) : 0; }

  /* Une sauvegarde est acceptée si sa structure est celle du site : chaque mois doit avoir une liste de comptes. */
  function valid(s) {
    if (!isObj(s) || s.v !== 2 || !C[s.country] || typeof s.base !== 'string' || !CUR_RE.test(s.base) || !isObj(s.months)) return false;
    var keys = Object.keys(s.months);
    if (!keys.length) return false;
    return keys.every(function (k) {
      var d = s.months[k];
      if (!MONTH_RE.test(k) || !isObj(d) || !Array.isArray(d.accounts)) return false;
      if (['sav', 'debt', 'wish'].some(function (f) { return d[f] !== undefined && !Array.isArray(d[f]); })) return false;
      return d.accounts.every(function (a) {
        return isObj(a) && (a.inc === undefined || Array.isArray(a.inc)) && (a.out === undefined || Array.isArray(a.out)) &&
          (a.cur === undefined || (typeof a.cur === 'string' && CUR_RE.test(a.cur)));
      });
    });
  }

  /* Complète ce qui manque et ramène chaque valeur à un type sûr (texte, montant, devise sur 3 lettres). */
  function normalize(s) {
    var base = s.base;
    var cur = function (c) { return typeof c === 'string' && CUR_RE.test(c) ? c : base; };
    var line = function (r, inc) {
      r = isObj(r) ? r : {};
      var o = { label: str(r.label, 80), cat: str(r.cat, 60) || (inc ? 'Autre revenu' : 'Divers'), amount: amt(r.amount) };
      if (r.once === true) o.once = true;
      if (r.auto === true) o.auto = true;
      if (typeof r.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.d)) o.d = r.d;
      return o;
    };
    var row = function (r) { r = isObj(r) ? r : {}; return { name: str(r.name, 80), pay: amt(r.pay), bal: amt(r.bal), cur: cur(r.cur) }; };
    Object.keys(s.months).forEach(function (k) {
      var d = s.months[k];
      d.accounts = d.accounts.filter(isObj).map(function (a) {
        var sal = isObj(a.sal) ? { brut: amt(a.sal.brut), soc: amt(a.sal.soc), tax: amt(a.sal.tax) } : null;
        if (sal && a.sal.x13 === true) sal.x13 = true;
        return {
          name: str(a.name, 60), bank: str(a.bank, 60), cur: cur(a.cur), sal: sal,
          inc: (Array.isArray(a.inc) ? a.inc : []).filter(isObj).map(function (r) { return line(r, true); }),
          out: (Array.isArray(a.out) ? a.out : []).filter(isObj).map(function (r) { return line(r, false); })
        };
      });
      d.sav = (Array.isArray(d.sav) ? d.sav : []).filter(isObj).map(row);
      d.debt = (Array.isArray(d.debt) ? d.debt : []).filter(isObj).map(row);
      d.wish = (Array.isArray(d.wish) ? d.wish : []).filter(isObj).map(function (w) { w = isObj(w) ? w : {}; return { label: str(w.label, 80), amount: amt(w.amount) }; });
      var plan = {};
      if (isObj(d.plan)) Object.keys(d.plan).forEach(function (c) { var v = amt(d.plan[c]); if (c.length <= 60) plan[c] = v; });
      d.plan = plan;
    });
    if (typeof s.cur !== 'string' || !MONTH_RE.test(s.cur)) s.cur = thisMonth();
    var rates = {}, src = {};
    if (isObj(s.rates)) Object.keys(s.rates).forEach(function (c) { var v = +s.rates[c]; if (CUR_RE.test(c) && isFinite(v) && v > 0) rates[c] = v; });
    if (isObj(s.rateSrc)) Object.keys(s.rateSrc).forEach(function (c) { if (CUR_RE.test(c)) src[c] = str(s.rateSrc[c], 20); });
    s.rates = rates; s.rateSrc = src;
    s.log = Array.isArray(s.log) ? s.log.filter(function (e) { return isObj(e) && typeof e.k === 'string'; }).slice(-LOG_MAX) : [];
    var opts = isObj(s.opts) ? s.opts : {};
    s.opts = { advance: opts.advance !== false, threshold: typeof opts.threshold === 'number' && isFinite(opts.threshold) ? opts.threshold : null };
    var learn = {};
    if (isObj(s.learn)) Object.keys(s.learn).slice(0, 500).forEach(function (k) { if (typeof s.learn[k] === 'string') learn[k.slice(0, 40)] = s.learn[k].slice(0, 60); });
    s.learn = learn;
    return s;
  }

  /* ---------- Stockage ---------- */

  function load() {
    storageOK = canStore();
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (valid(s)) return normalize(s);
      var old = JSON.parse(localStorage.getItem(OLD_KEY));
      if (old && old.months) return normalize(migrate(old));
    } catch (e) { /* données illisibles : on repart de zéro */ }
    return null;
  }
  function canStore() {
    try { localStorage.setItem('bm-test', '1'); localStorage.removeItem('bm-test'); return true; } catch (e) { return false; }
  }
  function saveLocal() {
    if (!S) return;
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; } catch (e) { storageOK = false; }
    $('storage-warning').hidden = storageOK;
  }
  function save(group) {
    track(group);
    dailyVersion();
    saveLocal();
    Sync.changed();
  }

  /* Reprise des données de l'ancienne version (format v1, Suisse, CHF et EUR). */
  function migrate(o) {
    var map = {
      'Ménage': 'Courses et ménage', 'Sorties / Loisirs': 'Loisirs et sorties', 'Habitation': 'Logement',
      'Frais divers': 'Divers', 'Téléphonie / Internet': 'Téléphone et internet', 'Assurance maladie': 'Santé et assurances',
      'Don': 'Dons', 'Remb. dette': 'Remboursement de dette', 'Revenu': 'Autre revenu'
    };
    var line = function (r) { return { label: String(r.label || ''), amount: num(r.amount), cat: map[r.cat] || r.cat || 'Divers' }; };
    var row = function (r) { return { name: String(r.name || ''), pay: num(r.pay), bal: num(r.bal), cur: r.cur || 'CHF' }; };
    var s = { v: 2, country: 'CH', base: 'CHF', rates: {}, rateSrc: {}, cur: o.cur || thisMonth(), months: {}, log: [] };
    if (o.rate > 0) {
      s.rates.EUR = o.rate;
      s.rateSrc.EUR = o.rateDate === 'manuel' ? 'manuel' : (o.rateDate && o.rateDate !== 'erreur' ? o.rateDate : '');
    }
    Object.keys(o.months).forEach(function (k) {
      var m = o.months[k] || {};
      s.months[k] = {
        accounts: (m.accounts || []).map(function (a) {
          return {
            name: String(a.name || 'Compte'), bank: '', cur: a.cur || 'CHF',
            sal: a.sal ? { brut: num(a.sal.brut), soc: num(a.sal.other), tax: num(a.sal.tax) } : null,
            inc: (a.inc || []).map(line), out: (a.out || []).map(line)
          };
        }),
        sav: (m.sav || []).map(row), debt: (m.debt || []).map(row),
        wish: (m.wish || []).map(function (w) { return { label: String(w.label || ''), amount: num(w.amount) }; })
      };
    });
    return s;
  }

  /* ---------- Annuler, rétablir, versions ---------- */

  var hist = { undo: [], redo: [], last: null, grouping: false, group: null, timer: null };
  function snap() {
    if (!S) return 'null';
    var copy = {};
    Object.keys(S).forEach(function (k) { if (k !== 'log' && k !== 'rates' && k !== 'rateSrc') copy[k] = S[k]; });
    return JSON.stringify(copy);
  }
  function resetHistory() { hist.undo = []; hist.redo = []; hist.last = snap(); hist.grouping = false; updateUndo(); }
  /* Chaque modification enregistrée garde l'état précédent ; les frappes successives dans un même champ
     comptent pour une seule étape. */
  function track(group) {
    var now = snap();
    if (hist.last === null) { hist.last = now; return; }
    if (now === hist.last) return;
    if (!(group && hist.grouping && hist.group === group)) {
      hist.undo.push(hist.last);
      if (hist.undo.length > 60) hist.undo.shift();
      hist.redo = [];
    }
    hist.last = now;
    hist.group = group || null;
    hist.grouping = !!group;
    clearTimeout(hist.timer);
    if (group) hist.timer = setTimeout(function () { hist.grouping = false; }, 1500);
    updateUndo();
  }
  function restoreSnap(json) {
    var o = JSON.parse(json);
    if (!o) {
      S = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* ignoré */ }
      return;
    }
    o.log = S ? S.log : [];
    o.rates = S ? S.rates : {};
    o.rateSrc = S ? S.rateSrc : {};
    S = normalize(o);
  }
  function undo() {
    if (!hist.undo.length) return;
    hist.grouping = false;
    hist.redo.push(snap());
    restoreSnap(hist.undo.pop());
    hist.last = snap();
    if (S) { log('undo'); saveLocal(); Sync.changed(); }
    updateUndo();
    location.hash = '';
    route();
    announce(t('undo.done'));
  }
  function redo() {
    if (!hist.redo.length) return;
    hist.grouping = false;
    hist.undo.push(snap());
    restoreSnap(hist.redo.pop());
    hist.last = snap();
    if (S) { log('redo'); saveLocal(); Sync.changed(); }
    updateUndo();
    route();
    announce(t('redo.done'));
  }
  function updateUndo() {
    var u = $('undo'), r = $('redo');
    if (u) u.disabled = !hist.undo.length;
    if (r) r.disabled = !hist.redo.length;
  }

  function readVersions() {
    try { var v = JSON.parse(localStorage.getItem(VERSIONS_KEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
  }
  /* Copie complète du budget, gardée sur cet appareil (10 au maximum). */
  function saveVersion(reason, data) {
    var d = data || S;
    if (!d) return;
    var list = readVersions();
    list.unshift({ t: Date.now(), r: reason, data: JSON.parse(JSON.stringify(d)) });
    while (list.length > 10) list.pop();
    for (var tries = 0; tries < 10; tries++) {
      try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(list)); return; } catch (e) { list.pop(); if (!list.length) return; }
    }
  }
  function dailyVersion() {
    if (!S) return;
    var list = readVersions(), today = new Date().toDateString();
    if (!list.length || new Date(list[0].t).toDateString() !== today) saveVersion('daily');
  }

  /* ---------- Outils ---------- */

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function country(cc) { return C[cc || (S && S.country)] || C.XX; }
  function cText(c, key) { var l = I.lang; return l !== 'fr' && c[l] && c[l][key] ? c[l][key] : (l !== 'fr' && c.en && c.en[key] ? c.en[key] : c[key]); }
  function cName(cc) { return cText(country(cc), 'name'); }
  function cLabel(key) { return cText(country(), key); }
  /* Format des montants : celui du pays, quelle que soit la langue (en Suisse : CHF 6’000.00). */
  function locale() {
    if (!S || S.country === 'XX') return I.lang;
    return S.country === 'CH' ? 'de-CH' : country().locale;
  }
  function D() { return S.months[S.cur]; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  var fmtCache = {};
  function fmt(n, cur) {
    var c = CUR_RE.test(cur || '') ? cur : (S ? S.base : 'EUR');
    var key = locale() + c;
    if (!fmtCache[key]) {
      try { fmtCache[key] = new Intl.NumberFormat(locale(), { style: 'currency', currency: c }); }
      catch (e) { fmtCache[key] = { format: function (x) { return x.toFixed(2) + ' ' + c; } }; }
    }
    return fmtCache[key].format(n || 0);
  }
  function plain(n) { return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(n || 0); }
  function pct(n) {
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n) + ' %';
  }
  function decSep() {
    try { var p = new Intl.NumberFormat(locale()).formatToParts(1.5); for (var i = 0; i < p.length; i++) if (p[i].type === 'decimal') return p[i].value; } catch (e) { /* ignoré */ }
    return '.';
  }
  function toBase(n, cur) {
    if (!cur || cur === S.base) return n;
    return n * (S.rates[cur] || 0);
  }
  function sum(list, key) { return list.reduce(function (s, x) { return s + num(x[key || 'amount']); }, 0); }
  function monthName(m) {
    var p = m.split('-');
    return new Intl.DateTimeFormat(I.lang, { month: 'long', year: 'numeric' }).format(new Date(+p[0], +p[1] - 1, 1));
  }
  function addMonths(m, delta) {
    var p = m.split('-'), d = new Date(+p[0], +p[1] - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function options(list, value, label) {
    var all = list.indexOf(value) === -1 && value ? list.concat([value]) : list;
    return all.map(function (c) {
      return '<option value="' + esc(c) + '"' + (c === value ? ' selected' : '') + '>' + esc(label ? label(c) : c) + '</option>';
    }).join('');
  }
  function outCats() {
    var extra = country().cats.filter(function (c) { return OUT_CATS.indexOf(c) === -1; });
    var i = OUT_CATS.indexOf('Divers');
    return OUT_CATS.slice(0, i).concat(extra, OUT_CATS.slice(i));
  }
  function currencyList() {
    return CURRENCIES.indexOf(S.base) === -1 ? [S.base].concat(CURRENCIES) : CURRENCIES;
  }
  /* Montant affiché dans un champ : sans séparateur de milliers, avec la virgule ou le point du pays. */
  function amountValue(n) { return n ? String(n).replace('.', decSep()) : ''; }
  function fetchTimeout(url, ms, opts) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var tm = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    var o = opts || {};
    if (ctrl) o.signal = ctrl.signal;
    return fetch(url, o).finally(function () { if (tm) clearTimeout(tm); });
  }
  function announce(text) { var el = $('live'); if (el) { el.textContent = ''; setTimeout(function () { el.textContent = text; }, 30); } }

  /* ---------- Lecture des montants saisis ----------
     « 812,50 », « 812.50 », « 1'500 », « 1 500,50 » et « 1.234,56 » sont compris.
     Un signe moins est refusé (un remboursement est un revenu), au-delà de 10 millions aussi. */
  function parseInput(v, signed) {
    var s = String(v == null ? '' : v).replace(/[\s  '’]/g, '');
    if (!s) return { v: 0, empty: true };
    var neg = /^[-−]/.test(s);
    if (neg && !signed) return { err: 'amount.negative' };
    s = s.replace(/^[-−+]/, '');
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { err: 'amount.invalid' };
    var dec = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    var tail = dec === -1 ? -1 : s.length - dec - 1;
    var seps = (s.match(/[.,]/g) || []).length;
    var n;
    if (dec === -1) n = +s;
    else if (tail === 0) n = +s.slice(0, dec).replace(/[.,]/g, '');
    else if (tail <= 2) n = +(s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1));
    else if (tail === 3 && (seps > 1 || s.slice(0, dec).replace(/[.,]/g, '').length <= 3)) n = +s.replace(/[.,]/g, '');
    else return { err: 'amount.invalid' };
    if (!isFinite(n)) return { err: 'amount.invalid' };
    if (n > MAX_AMOUNT) return { err: 'amount.tooBig' };
    return { v: Math.round((neg ? -n : n) * 100) / 100 };
  }
  /* Taux de change : un seul séparateur est toujours la virgule décimale (0,9312). */
  function parseRate(v) {
    var s = String(v == null ? '' : v).replace(/[\s  '’]/g, '');
    if (!s) return { v: 0 };
    if (!/^[\d.,]+$/.test(s)) return { err: 'amount.invalid' };
    var dec = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    var n = dec === -1 ? +s : +(s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1));
    return isFinite(n) && n < 1e6 ? { v: n } : { err: 'amount.invalid' };
  }
  function fieldError(el, key) {
    var id = 'err-' + (el.id || el.getAttribute('data-p') || el.getAttribute('data-plan') || el.getAttribute('data-rate') || 'x').replace(/[^\w-]/g, '-');
    var box = document.getElementById(id);
    if (!key) {
      el.removeAttribute('aria-invalid');
      if (box) box.remove();
      var by = (el.getAttribute('aria-describedby') || '').split(' ').filter(function (x) { return x && x !== id; }).join(' ');
      if (by) el.setAttribute('aria-describedby', by); else el.removeAttribute('aria-describedby');
      return;
    }
    el.setAttribute('aria-invalid', 'true');
    if (!box) {
      box = document.createElement('p');
      box.className = 'field-error';
      box.id = id;
      var host = el.closest('.row, .line, .rate-row, .field, td') || el.parentNode;
      host.insertAdjacentElement(host.tagName === 'TD' ? 'beforeend' : 'afterend', box);
      var cur = el.getAttribute('aria-describedby');
      el.setAttribute('aria-describedby', (cur ? cur + ' ' : '') + id);
    }
    box.textContent = t(key, { max: plain(MAX_AMOUNT) });
  }

  /* ---------- Catégories devinées et apprises ---------- */

  function learnKey(label) {
    return String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\d+/g, ' ').replace(/[^a-zß ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  }
  /* Catégorie choisie auparavant pour un libellé semblable (« Coop Pronto » corrigé une fois en Courses). */
  function learned(label) {
    if (!S || !S.learn) return null;
    var k = learnKey(label);
    if (!k) return null;
    if (S.learn[k]) return S.learn[k];
    var best = null;
    Object.keys(S.learn).forEach(function (x) {
      if (x.length >= 4 && (k.indexOf(x) === 0 || (' ' + k + ' ').indexOf(' ' + x + ' ') !== -1) && (!best || x.length > best.length)) best = x;
    });
    return best ? S.learn[best] : null;
  }
  function learn(label, cat) {
    var k = learnKey(label);
    if (!S || !k || k.length < 3) return;
    S.learn[k] = cat;
    var keys = Object.keys(S.learn);
    if (keys.length > 500) delete S.learn[keys[0]];
  }
  function guessCat(label, type) {
    var g = window.BMFiles && window.BMFiles.guess ? window.BMFiles.guess(label, type === 'inc' ? 1 : -1) : null;
    if (!g || !g.known) return null;
    var list = type === 'inc' ? IN_CATS : outCats();
    return list.indexOf(g.cat) !== -1 ? g.cat : null;
  }

  /* ---------- Journal des modifications ---------- */

  function log(k, p) {
    if (!S) return;
    S.log.push({ t: Date.now(), m: S.cur, k: k, p: p || {} });
    if (S.log.length > LOG_MAX) S.log.splice(0, S.log.length - LOG_MAX);
  }

  /* ---------- Mois ---------- */

  function emptyMonth(bank) {
    return {
      accounts: [{ name: t('mainAccount'), bank: bank || '', cur: S.base, sal: { brut: 0, soc: 0, tax: 0 }, inc: [], out: [] }],
      sav: [], debt: [], wish: [], plan: {}
    };
  }
  /* Même structure (comptes, épargne, dettes, budget prévu), sans aucune ligne ni montant du mois. */
  function blankFrom(src) {
    if (!src) return emptyMonth('');
    return {
      accounts: src.accounts.map(function (a) { return { name: a.name, bank: a.bank, cur: a.cur, sal: a.sal ? { brut: 0, soc: 0, tax: 0 } : null, inc: [], out: [] }; }),
      sav: src.sav.map(function (r) { return { name: r.name, pay: 0, bal: r.bal, cur: r.cur }; }),
      debt: src.debt.map(function (r) { return { name: r.name, pay: 0, bal: r.bal, cur: r.cur }; }),
      wish: src.wish.map(function (w) { return { label: w.label, amount: w.amount }; }),
      plan: JSON.parse(JSON.stringify(src.plan || {}))
    };
  }
  /* Reprend un mois : les lignes ponctuelles et celles d'un relevé (datées) ne sont pas recopiées ;
     si l'option est active, l'épargne augmente du versement et la dette baisse de la mensualité. */
  function copyFrom(src, forward) {
    var d = JSON.parse(JSON.stringify(src));
    d.accounts.forEach(function (a) {
      ['inc', 'out'].forEach(function (k) { a[k] = a[k].filter(function (x) { return !x.once && !x.d; }); });
    });
    if (forward && S.opts.advance) {
      d.sav.forEach(function (r) { r.bal = Math.round((r.bal + r.pay) * 100) / 100; });
      d.debt.forEach(function (r) { r.bal = Math.max(0, Math.round((r.bal - r.pay) * 100) / 100); });
    }
    return d;
  }
  function nearestMonth(m) {
    var keys = Object.keys(S.months).sort();
    var before = keys.filter(function (k) { return k < m; }).pop();
    return before || keys.filter(function (k) { return k > m; })[0] || null;
  }
  /* Utilisé par les imports : crée un mois absent avec la structure du mois le plus proche, sans ses lignes. */
  function ensureBlank(m) {
    if (S.months[m]) return false;
    var src = nearestMonth(m);
    S.months[m] = blankFrom(src ? S.months[src] : null);
    return true;
  }
  function shiftMonth(delta) {
    S.cur = addMonths(S.cur, delta);
    saveLocal();
    render();
  }

  /* ---------- Premier lancement ---------- */

  function sortedCountries() {
    var codes = Object.keys(C).filter(function (k) { return k !== 'XX'; })
      .sort(function (a, b) { return cName(a).localeCompare(cName(b), I.lang); });
    codes.push('XX');
    return codes;
  }
  function fillCountrySelect(sel, value) {
    sel.innerHTML = sortedCountries().map(function (k) {
      return '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' + esc(cName(k)) + '</option>';
    }).join('');
  }
  function fillCurrencySelect(sel, value) {
    var list = CURRENCIES.indexOf(value) === -1 ? [value].concat(CURRENCIES) : CURRENCIES;
    sel.innerHTML = options(list, value);
  }
  function fillBanks(cc) {
    $('banks-list').innerHTML = C[cc].banks.map(function (b) { return '<option value="' + esc(b) + '">'; }).join('');
  }

  var detected = null;
  function detectCountry() {
    var fromApi = API
      ? fetchTimeout(API + '/country', 2500).then(function (r) { return r.json(); })
        .then(function (j) { return j && C[j.country] ? { cc: j.country, how: 'detect.ip' } : null; })
        .catch(function () { return null; })
      : Promise.resolve(null);
    return fromApi.then(function (res) {
      if (res) return res;
      var tz = '';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignoré */ }
      var keys = Object.keys(C);
      for (var i = 0; i < keys.length; i++) {
        if (C[keys[i]].tz.indexOf(tz) !== -1) return { cc: keys[i], how: 'detect.tz' };
      }
      var langs = navigator.languages || [navigator.language || ''];
      for (var j = 0; j < langs.length; j++) {
        var m = /-([a-z]{2})$/i.exec(langs[j] || '');
        if (m && C[m[1].toUpperCase()]) return { cc: m[1].toUpperCase(), how: 'detect.lang' };
      }
      return { cc: 'XX', how: '' };
    });
  }

  function detectText() {
    if (!detected) return t('detect.searching');
    return detected.how ? t('detect.found', { how: t(detected.how) }) : t('detect.choose');
  }

  function showSetup() {
    $('setup').hidden = false;
    $('budget').hidden = true;
    var sel = $('setup-country');
    fillCountrySelect(sel, detected ? detected.cc : 'XX');
    fillCurrencySelect($('setup-cur'), detected ? C[detected.cc].cur : 'EUR');
    fillBanks(detected ? detected.cc : 'XX');
    $('setup-detect').textContent = detectText();
    if (detected) return;
    detectCountry().then(function (r) {
      detected = r;
      if (S) return;
      fillCountrySelect(sel, r.cc);
      fillCurrencySelect($('setup-cur'), C[r.cc].cur);
      fillBanks(r.cc);
      $('setup-detect').textContent = detectText();
    });
  }

  $('setup-country').addEventListener('change', function (e) {
    var cc = e.target.value;
    fillCurrencySelect($('setup-cur'), C[cc].cur);
    fillBanks(cc);
    detected = { cc: cc, how: '' };
    $('setup-detect').textContent = '';
  });

  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var cc = $('setup-country').value;
    var cur = $('setup-cur').value;
    if (!C[cc] || !CUR_RE.test(cur)) return;
    S = normalize({ v: 2, country: cc, base: cur, rates: {}, rateSrc: {}, cur: thisMonth(), months: {}, log: [] });
    S.months[S.cur] = emptyMonth($('setup-bank').value.trim().slice(0, 60));
    log('create');
    resetHistory();
    save();
    route();
    var first = document.querySelector('#accounts input');
    if (first) first.focus();
  });

  /* ---------- Affichage du budget ---------- */

  function rowsHead(cols, cls) {
    return '<div class="row-head' + (cls ? ' ' + cls : '') + '" aria-hidden="true">' + cols.map(function (c) { return '<span>' + c + '</span>'; }).join('') + '</div>';
  }
  function amountInput(label, path, value, id) {
    return '<input' + (id ? ' id="' + id + '"' : '') + (label ? ' aria-label="' + esc(label) + '"' : '') + ' type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="0" data-amount data-p="' + path + '" value="' + amountValue(value) + '">';
  }

  function lineRow(path, r, cats) {
    return '<div class="row">' +
      '<input aria-label="' + t('col.label') + '" maxlength="80" data-p="' + path + '.label" value="' + esc(r.label) + '">' +
      '<select aria-label="' + t('col.cat') + '" data-p="' + path + '.cat">' + options(cats, r.cat, I.cat) + '</select>' +
      amountInput(t('col.amount'), path + '.amount', r.amount) +
      '<label class="once"><input type="checkbox" data-once="' + path + '"' + (r.once ? ' checked' : '') + ' aria-label="' + esc(t('once.aria', { label: r.label || t('empty') })) + '"><span class="once-txt" aria-hidden="true">' + t('col.once') + '</span></label>' +
      '<button type="button" class="del" data-del="' + path + '" aria-label="' + esc(t('del.line', { label: r.label })) + '">×</button>' +
      '</div>';
  }

  var folded = (function () { try { var f = JSON.parse(localStorage.getItem(FOLD_KEY)); return isObj(f) ? f : {}; } catch (e) { return {}; } })();
  function saveFolded() { try { localStorage.setItem(FOLD_KEY, JSON.stringify(folded)); } catch (e) { /* ignoré */ } }

  function accountHtml(a, i) {
    var p = 'accounts.' + i;
    var isFolded = !!folded[a.name];
    var sal = a.sal
      ? '<div class="salary">' +
        '<label class="line" for="sb' + i + '"><span>' + t('salary.gross') + '</span>' + amountInput('', p + '.sal.brut', a.sal.brut, 'sb' + i) + '</label>' +
        '<label class="line" for="ss' + i + '"><span>' + esc(cLabel('soc')) + '</span>' + amountInput('', p + '.sal.soc', a.sal.soc, 'ss' + i) + '</label>' +
        '<label class="line" for="st' + i + '"><span>' + esc(cLabel('tax')) + '</span>' + amountInput('', p + '.sal.tax', a.sal.tax, 'st' + i) + '</label>' +
        '<label class="check x13"><input type="checkbox" data-x13="' + i + '"' + (a.sal.x13 ? ' checked' : '') + '><span>' + t('salary.x13') + '</span></label>' +
        '<div class="line strong"><span>' + t('salary.net') + '</span><output id="net' + i + '"></output></div>' +
        '<p class="hint" id="net13-' + i + '"' + (a.sal.x13 ? '' : ' hidden') + '></p>' +
        '<button type="button" class="link" data-delsal="' + i + '">' + t('salary.remove') + '</button>' +
        '</div>'
      : '<button type="button" class="link" data-addsal="' + i + '">' + t('salary.add') + '</button>';
    var head = [t('col.label'), t('col.cat'), t('col.amount'), t('col.once'), ''];

    return '<article class="account' + (isFolded ? ' folded' : '') + '" aria-labelledby="acc' + i + '">' +
      '<div class="account-top"><h3 id="acc' + i + '">' + esc(a.name || ('#' + (i + 1))) + '</h3>' +
      '<p class="account-sum" id="fs' + i + '"></p>' +
      '<button type="button" class="link inline fold" data-fold="' + i + '" aria-expanded="' + !isFolded + '" aria-controls="ab' + i + '">' + t(isFolded ? 'acc.unfold' : 'acc.fold') + '</button></div>' +
      '<div class="account-body" id="ab' + i + '"' + (isFolded ? ' hidden' : '') + '>' +
      '<div class="account-head">' +
      '<label class="field"><span>' + t('acc.name') + '</span><input maxlength="60" data-p="' + p + '.name" value="' + esc(a.name) + '"></label>' +
      '<label class="field"><span>' + t('acc.bank') + '</span><input maxlength="60" list="banks-list" data-p="' + p + '.bank" value="' + esc(a.bank) + '" placeholder="' + esc(t('acc.bankPh')) + '"></label>' +
      '<label class="field narrow"><span>' + t('acc.cur') + '</span><select data-p="' + p + '.cur">' + options(currencyList(), a.cur) + '</select></label>' +
      '</div>' +
      '<h4>' + t('income') + '</h4>' + sal +
      (a.inc.length ? rowsHead(head) : '') +
      a.inc.map(function (r, j) { return lineRow(p + '.inc.' + j, r, IN_CATS); }).join('') +
      '<button type="button" class="link" data-add="' + p + '.inc">' + t('add.income') + '</button>' +
      '<h4>' + t('expenses') + '</h4>' +
      (a.out.length ? rowsHead(head) : '') +
      a.out.map(function (r, j) { return lineRow(p + '.out.' + j, r, outCats()); }).join('') +
      '<button type="button" class="link" data-add="' + p + '.out">' + t('add.expense') + '</button>' +
      '<dl class="totals">' +
      '<div><dt>' + t('tot.in') + '</dt><dd id="ti' + i + '"></dd></div>' +
      '<div><dt>' + t('tot.out') + '</dt><dd id="to' + i + '"></dd></div>' +
      '<div class="solde"><dt>' + t('tot.bal') + '</dt><dd id="ts' + i + '"></dd></div>' +
      '</dl>' +
      '<button type="button" class="link danger" data-delacc="' + i + '">' + t('del.account') + '</button>' +
      '</div></article>';
  }

  function listBlock(title, key, cols, hint) {
    var d = D();
    var rows = d[key].map(function (r, j) {
      var p = key + '.' + j;
      return '<div class="row four">' +
        '<input aria-label="' + cols[0] + '" maxlength="80"' + (key === 'sav' ? ' list="savings-list"' : '') + ' data-p="' + p + '.name" value="' + esc(r.name) + '">' +
        amountInput(cols[1], p + '.pay', r.pay) +
        amountInput(cols[2], p + '.bal', r.bal) +
        '<select aria-label="' + t('col.cur') + '" data-p="' + p + '.cur">' + options(currencyList(), r.cur) + '</select>' +
        '<button type="button" class="del" data-del="' + p + '" aria-label="' + esc(t('del.line', { label: r.name })) + '">×</button>' +
        '</div>';
    }).join('');
    return '<section class="block" aria-labelledby="h-' + key + '"><h3 id="h-' + key + '">' + title + '</h3>' +
      '<p class="hint">' + hint + '</p>' +
      (d[key].length ? rowsHead(cols.concat([t('col.cur'), '']), 'four') : '') + rows +
      '<button type="button" class="link" data-add="' + key + '">' + t('add.line') + '</button>' +
      '<p class="block-total" id="t_' + key + '"></p></section>';
  }

  function wishBlock() {
    var d = D();
    return '<section class="block" aria-labelledby="h-wish"><h3 id="h-wish">' + t('wish.h') + '</h3>' +
      '<p class="hint">' + esc(t('wish.hint', { cur: S.base })) + '</p>' +
      (d.wish.length ? rowsHead([t('col.item'), t('col.price'), ''], 'two') : '') +
      d.wish.map(function (r, j) {
        return '<div class="row two">' +
          '<input aria-label="' + t('col.item') + '" maxlength="80" data-p="wish.' + j + '.label" value="' + esc(r.label) + '">' +
          amountInput(t('col.price'), 'wish.' + j + '.amount', r.amount) +
          '<button type="button" class="del" data-del="wish.' + j + '" aria-label="' + esc(t('del.line', { label: r.label })) + '">×</button>' +
          '</div>';
      }).join('') +
      '<button type="button" class="link" data-add="wish">' + t('add.wish') + '</button>' +
      '<p class="block-total" id="t_wish"></p><ul class="goals" id="goals"></ul></section>';
  }

  /* Repères suisses : plafond du 3e pilier A et provision d'impôts depuis janvier. */
  function swissBlock() {
    if (S.country !== 'CH') return '';
    return '<section class="block" aria-labelledby="h-swiss"><h3 id="h-swiss">' + t('ch.h') + '</h3><div id="swiss"></div></section>';
  }

  function monthOptions() {
    var keys = Object.keys(S.months).concat([S.cur, thisMonth()]).sort();
    var first = addMonths(keys[0], -1), last = addMonths(keys[keys.length - 1], 1), list = [];
    for (var m = first; m <= last && list.length < 400; m = addMonths(m, 1)) list.push(m);
    return list.map(function (m) {
      return '<option value="' + m + '"' + (m === S.cur ? ' selected' : '') + '>' + esc(monthName(m)) + (S.months[m] ? '' : ' · ' + esc(t('month.none'))) + '</option>';
    }).join('');
  }

  function render() {
    saveLocal();
    var name = monthName(S.cur);
    $('month').innerHTML = monthOptions();
    $('month-title').textContent = I.lang === 'fr'
      ? t('budgetOf', { de: /^[aeiouyàâéèêîôû]/i.test(name) ? 'd\'' : 'de ', month: name })
      : t('budgetOf', { month: name });
    $('country-label').textContent = t('countryLine', { country: cName(), cur: S.base });
    updateUndo();
    var d = S.months[S.cur];
    $('month-body').hidden = !d;
    $('month-empty').hidden = !!d;
    $('sticky-sum').hidden = !d;
    if (!d) { renderEmptyMonth(); return; }
    $('savings-list').innerHTML = country().savings.map(function (b) { return '<option value="' + esc(I.saving(b)) + '">'; }).join('');
    fillBanks(S.country);
    chartSig = '';
    $('accounts').innerHTML = d.accounts.map(accountHtml).join('');
    $('others').innerHTML =
      '<p class="hint">' + esc(t('others.hint')) + '</p>' +
      listBlock(t('sav.h'), 'sav', [t('col.name'), t('col.pay'), t('col.bal')], t('sav.hint')) +
      listBlock(t('debt.h'), 'debt', [t('col.name'), t('col.repay'), t('col.left')], t('debt.hint')) +
      wishBlock() + swissBlock();
    renderRates();
    update();
    if (!ratesFetched || missingRates().length) fetchRates(false);
  }

  /* Mois pas encore créé : rien n'est ajouté tant que la personne n'a pas choisi. */
  function renderEmptyMonth() {
    var src = nearestMonth(S.cur);
    $('empty-text').textContent = t('empty.text', { month: monthName(S.cur) });
    var copy = $('empty-copy');
    copy.hidden = !src;
    if (src) {
      copy.setAttribute('data-from', src);
      copy.textContent = t('empty.copy', { month: monthName(src) });
      $('empty-hint').textContent = t(src < S.cur && S.opts.advance ? 'empty.hintAdvance' : 'empty.hint');
    } else $('empty-hint').textContent = '';
  }
  $('empty-copy').addEventListener('click', function () {
    var src = this.getAttribute('data-from');
    if (!S.months[src]) return;
    S.months[S.cur] = copyFrom(S.months[src], src < S.cur);
    log('monthCopy', { from: monthName(src) });
    save(); render();
  });
  $('empty-blank').addEventListener('click', function () {
    var src = nearestMonth(S.cur);
    S.months[S.cur] = blankFrom(src ? S.months[src] : null);
    log('monthBlank');
    save(); render();
  });

  /* Calcule les totaux d'un mois, convertis dans la devise principale. */
  function salary(a) {
    if (!a.sal) return { brut: 0, soc: 0, tax: 0, net: 0 };
    var k = a.sal.x13 ? 13 / 12 : 1;
    var brut = num(a.sal.brut) * k, soc = num(a.sal.soc) * k, tax = num(a.sal.tax) * k;
    return { brut: brut, soc: soc, tax: tax, net: brut - soc - tax };
  }
  function calc(d, perAccount) {
    var r = { rev: 0, dep: 0, brut: 0, held: 0, byCat: {}, accounts: [] };
    d.accounts.forEach(function (a, i) {
      var s = salary(a);
      if (a.sal) {
        r.brut += toBase(s.brut, a.cur);
        r.held += toBase(s.soc + s.tax, a.cur);
      }
      r.rev += toBase(s.net, a.cur);
      a.inc.forEach(function (x) { if (x.cat !== INTERNAL) r.rev += toBase(num(x.amount), a.cur); });
      a.out.forEach(function (x) {
        if (x.cat === INTERNAL) return;
        var v = toBase(num(x.amount), a.cur);
        r.dep += v;
        r.byCat[x.cat] = (r.byCat[x.cat] || 0) + v;
      });
      var ti = sum(a.inc) + s.net, to = sum(a.out);
      r.accounts.push({ name: a.name, cur: a.cur, bal: ti - to });
      if (perAccount) perAccount(a, i, s.net, ti, to);
    });
    var pay = function (k) { return d[k].reduce(function (s, x) { return s + toBase(num(x.pay), x.cur); }, 0); };
    var bal = function (k) { return d[k].reduce(function (s, x) { return s + toBase(num(x.bal), x.cur); }, 0); };
    r.savPay = pay('sav'); r.sav = bal('sav'); r.debtPay = pay('debt'); r.debt = bal('debt');
    r.wish = sum(d.wish);
    r.solde = r.rev - r.dep;
    // Versements d'épargne et mensualités : déduits seulement s'ils ne sont pas déjà notés comme dépenses.
    r.savLeft = Math.max(0, r.savPay - (r.byCat['Épargne'] || 0));
    r.debtLeft = Math.max(0, r.debtPay - (r.byCat['Remboursement de dette'] || 0));
    r.reste = r.solde - r.savLeft - r.debtLeft;
    return r;
  }

  function update() {
    var d = D();
    if (!d) return;
    var r = calc(d, function (a, i, net, ti, to) {
      if (a.sal) {
        var out = $('net' + i);
        out.textContent = fmt(net, a.cur);
        out.className = net < 0 ? 'neg' : '';
        var n13 = $('net13-' + i);
        if (n13) { n13.hidden = !a.sal.x13; n13.textContent = a.sal.x13 ? t('salary.x13hint', { amount: fmt(net / 13, a.cur) }) : ''; }
      }
      var ts = ti - to;
      $('ti' + i).textContent = fmt(ti, a.cur);
      $('to' + i).textContent = fmt(to, a.cur);
      var e = $('ts' + i);
      e.textContent = fmt(ts, a.cur) + (ts < 0 ? ' ' + t('flag.overdrawnShort') : '');
      e.className = ts < 0 ? 'neg' : '';
      var fs = $('fs' + i);
      if (fs) { fs.textContent = t('tot.bal') + ' : ' + fmt(ts, a.cur); fs.className = 'account-sum' + (ts < 0 ? ' neg' : ''); }
    });
    $('t_sav').textContent = t('sav.total', { pay: fmt(r.savPay, S.base), bal: fmt(r.sav, S.base) });
    $('t_debt').textContent = t('debt.total', { pay: fmt(r.debtPay, S.base), bal: fmt(r.debt, S.base) });
    $('t_wish').textContent = t('wish.total', { total: fmt(r.wish, S.base) });
    summary(r);
    chart(r.byCat, r.dep, d.plan);
    goals();
    swiss();
  }

  /* Résumé : solde du mois en premier, puis le reste après épargne et dettes, puis les alertes. */
  function summary(r) {
    var flag = '', cls = r.solde < 0 ? 'neg' : '';
    var under = S.opts.threshold !== null && r.solde < S.opts.threshold;
    if (r.solde < 0) flag = t('flag.deficit');
    else if (r.rev > 0 && r.solde < r.rev * 0.05) flag = t('flag.low');
    if (under) cls += ' strong';
    $('headline').innerHTML =
      '<div class="kpi main"><span class="kpi-label">' + t('sum.bal') + '</span><strong class="kpi-value ' + cls + '">' + fmt(r.solde, S.base) + '</strong>' +
      (flag ? '<span class="kpi-flag' + (r.solde < 0 ? ' neg' : '') + '">' + esc(flag) + '</span>' : '') + '</div>' +
      '<div class="kpi"><span class="kpi-label">' + t('sum.reste') + '</span><strong class="kpi-value' + (r.reste < 0 ? ' neg' : '') + '">' + fmt(r.reste, S.base) + '</strong>' +
      '<span class="kpi-note">' + esc(t('sum.resteNote', { sav: fmt(r.savLeft, S.base), debt: fmt(r.debtLeft, S.base) })) + '</span></div>';
    var alerts = [];
    if (under) alerts.push(t('alert.threshold', { amount: fmt(S.opts.threshold, S.base) }));
    if (r.solde >= 0) r.accounts.forEach(function (a) { if (a.bal < 0) alerts.push(t('alert.overdrawn', { name: a.name || t('noName'), amount: fmt(a.bal, a.cur) })); });
    var plan = D().plan || {};
    Object.keys(plan).forEach(function (c) { var spent = r.byCat[c] || 0; if (plan[c] > 0 && spent > plan[c]) alerts.push(t('alert.overPlan', { cat: I.cat(c), amount: fmt(spent - plan[c], S.base) })); });
    var miss = missingRates();
    if (miss.length) alerts.push(t('alert.noRate', { n: miss.length, list: miss.join(', ') }));
    $('alerts').innerHTML = alerts.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('alerts').hidden = !alerts.length;

    var items = [];
    if (r.brut) items.push([t('sum.gross'), fmt(r.brut, S.base), '']);
    if (r.held) items.push([t('sum.held'), fmt(r.held, S.base), '']);
    items.push([t('sum.net'), fmt(r.rev, S.base), '']);
    items.push([t('sum.out'), fmt(r.dep, S.base), '']);
    items.push([t('sum.sav'), fmt(r.sav, S.base), '']);
    items.push([t('sum.debt'), fmt(r.debt, S.base), '']);
    $('summary').className = 'summary cols-' + (items.length === 6 ? 3 : items.length);
    $('summary').innerHTML = items.map(function (k) {
      return '<div><dt>' + k[0] + '</dt><dd class="' + k[2] + '">' + k[1] + '</dd></div>';
    }).join('');
    $('sticky-sum').innerHTML = '<span>' + t('sum.bal') + '</span> <strong class="' + (r.solde < 0 ? 'neg' : '') + '">' + fmt(r.solde, S.base) + '</strong>' + (flag ? ' <span>' + esc(flag) + '</span>' : '');
  }

  /* Dépenses par catégorie, avec le budget prévu (F1). La table n'est reconstruite que si les catégories changent. */
  var chartSig = '';
  function chart(byCat, total, plan) {
    plan = plan || {};
    var list = Object.keys(byCat).filter(function (k) { return byCat[k] > 0; });
    Object.keys(plan).forEach(function (k) { if (list.indexOf(k) === -1) list.push(k); });
    list.sort(function (a, b) { return (byCat[b] || 0) - (byCat[a] || 0) || (plan[b] || 0) - (plan[a] || 0); });
    var box = $('chart');
    var sig = list.join('|') + '#' + I.lang;
    var free = outCats().filter(function (c) { return c !== INTERNAL && list.indexOf(c) === -1; });
    if (sig !== chartSig) {
      chartSig = sig;
      box.innerHTML = (list.length ? '<div class="history-wrap"><table class="bars"><caption class="visually-hidden">' + esc(t('chart.caption', { cur: S.base })) + '</caption>' +
        '<thead><tr><th scope="col">' + t('col.cat') + '</th><th scope="col" class="bar-col"><span class="visually-hidden">' + t('chart.share') + '</span></th><th scope="col">' + t('chart.spent') + '</th><th scope="col">' + t('chart.plan') + '</th><th scope="col">' + t('chart.left') + '</th><th scope="col" class="part-col">' + t('chart.part') + '</th></tr></thead><tbody>' +
        list.map(function (k, i) {
          return '<tr data-cat="' + esc(k) + '"><th scope="row">' + esc(I.cat(k)) + '</th>' +
            '<td class="bar-cell"><span class="bar"></span></td>' +
            '<td class="num c-spent"></td>' +
            '<td class="num c-plan"><input type="text" inputmode="decimal" autocomplete="off" id="plan-' + i + '" data-plan="' + esc(k) + '" aria-label="' + esc(t('chart.planFor', { cat: I.cat(k) })) + '" placeholder="-" value="' + amountValue(plan[k]) + '"></td>' +
            '<td class="num c-left"></td><td class="num c-part part-col"></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="hint">' + t('chart.empty') + '</p>') +
        (free.length ? '<p class="plan-add"><label for="plan-add">' + t('chart.addPlan') + '</label> <select id="plan-add"><option value="">' + esc(t('chart.choose')) + '</option>' +
          free.map(function (c) { return '<option value="' + esc(c) + '">' + esc(I.cat(c)) + '</option>'; }).join('') + '</select></p>' : '');
    }
    var max = list.reduce(function (m, k) { return Math.max(m, byCat[k] || 0, plan[k] || 0); }, 0) || 1;
    var rows = box.querySelectorAll('tr[data-cat]');
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].getAttribute('data-cat'), spent = byCat[k] || 0, p = plan[k] || 0, over = p > 0 && spent > p;
      rows[i].className = over ? 'over' : '';
      rows[i].querySelector('.bar').style.width = (spent / max * 100).toFixed(2) + '%';
      rows[i].querySelector('.c-spent').textContent = fmt(spent, S.base);
      rows[i].querySelector('.c-left').textContent = p > 0 ? (over ? t('chart.over', { amount: fmt(spent - p, S.base) }) : fmt(p - spent, S.base)) : '';
      rows[i].querySelector('.c-part').textContent = total > 0 ? pct(spent / total * 100) : '';
    }
  }

  /* Envies d'achat : temps nécessaire au rythme du reste moyen des 3 derniers mois. */
  function averageReste() {
    var keys = Object.keys(S.months).filter(function (k) { return k <= S.cur; }).sort().slice(-3);
    if (!keys.length) return 0;
    return keys.reduce(function (s, k) { return s + calc(S.months[k]).reste; }, 0) / keys.length;
  }
  function goals() {
    var box = $('goals');
    if (!box) return;
    var wish = D().wish.filter(function (w) { return w.amount > 0; });
    if (!wish.length) { box.innerHTML = ''; return; }
    var avg = averageReste();
    box.innerHTML = wish.map(function (w) {
      var text = avg > 0
        ? t('goal.months', { label: w.label || t('empty'), n: Math.max(1, Math.ceil(w.amount / avg)), avg: fmt(avg, S.base) })
        : t('goal.none', { label: w.label || t('empty') });
      return '<li>' + esc(text) + '</li>';
    }).join('');
  }

  function swiss() {
    var box = $('swiss');
    if (!box) return;
    var year = S.cur.slice(0, 4);
    var months = Object.keys(S.months).filter(function (k) { return k.slice(0, 4) === year && k <= S.cur; });
    var pillar = 0, taxes = 0;
    months.forEach(function (k) {
      var d = S.months[k];
      d.sav.forEach(function (r) { if (/3e pilier|pilier 3a|3a|s[äa]ule 3a|pillar 3a/i.test(r.name)) pillar += toBase(r.pay, r.cur); });
      d.accounts.forEach(function (a) { a.out.forEach(function (x) { if (x.cat === 'Provision impôts' || x.cat === 'Impôts') taxes += toBase(x.amount, a.cur); }); });
    });
    box.innerHTML = '<p>' + esc(t('ch.pillar', { year: year, paid: fmt(pillar, S.base), max: fmt(PILLAR3A_MAX.withLpp, 'CHF') })) + '</p>' +
      (pillar > PILLAR3A_MAX.withLpp ? '<p class="neg">' + esc(t('ch.pillarOver', { max: fmt(PILLAR3A_MAX.withLpp, 'CHF') })) + '</p>' : '') +
      '<p class="hint">' + esc(t('ch.pillarHint', { max: fmt(PILLAR3A_MAX.withoutLpp, 'CHF') })) + '</p>' +
      '<p>' + esc(t('ch.taxes', { year: year, amount: fmt(taxes, S.base) })) + '</p>' +
      '<p class="hint">' + esc(t('ch.taxesHint')) + '</p>';
  }

  /* ---------- Taux de change ---------- */

  function foreign() {
    var d = D(), set = {};
    if (!d) return [];
    d.accounts.forEach(function (a) { if (a.cur !== S.base) set[a.cur] = 1; });
    d.sav.concat(d.debt).forEach(function (r) { if (r.cur && r.cur !== S.base) set[r.cur] = 1; });
    return Object.keys(set).filter(function (c) { return CUR_RE.test(c); }).sort();
  }
  function missingRates() { return foreign().filter(function (c) { return !(S.rates[c] > 0); }); }
  function eurQuotable(cur) { return cur === 'EUR' || cur === 'XOF' || ECB.indexOf(cur) !== -1; }

  function renderRates() {
    var list = foreign();
    $('rates').hidden = !list.length;
    if (!list.length) return;
    $('rates-list').innerHTML = list.map(function (cur) {
      var src = S.rateSrc[cur] || '';
      var note = src === 'manuel' ? t('rate.manual')
        : /^\d{4}-\d{2}-\d{2}$/.test(src) ? t('rate.ecb', { date: new Date(src + 'T12:00:00').toLocaleDateString(locale()) })
        : eurQuotable(cur) && eurQuotable(S.base) ? t('rate.pending') : t('rate.missing');
      var c = esc(cur);
      return '<div class="rate-row"><label for="rate-' + c + '">1 ' + c + ' =</label>' +
        '<input id="rate-' + c + '" type="text" inputmode="decimal" autocomplete="off" data-rate="' + c + '" value="' + (S.rates[cur] ? String(S.rates[cur]).replace('.', decSep()) : '') + '">' +
        '<span>' + esc(S.base) + '</span><small>' + esc(note) + '</small></div>';
    }).join('');
  }

  function fetchRates(force) {
    ratesFetched = true;
    var need = foreign().filter(function (c) { return force || S.rateSrc[c] !== 'manuel' || !(S.rates[c] > 0); });
    if (!need.length || !eurQuotable(S.base)) { renderRates(); return; }
    var symbols = {};
    need.concat([S.base]).forEach(function (c) { if (c !== 'EUR' && c !== 'XOF' && ECB.indexOf(c) !== -1) symbols[c] = 1; });
    var keys = Object.keys(symbols);
    var direct = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=' + keys.join(',');
    var url = API ? API + '/rates?symbols=' + keys.join(',') : direct;
    var getJson = function (u) {
      return fetchTimeout(u, 6000).then(function (r) { if (!r.ok) throw new Error('taux'); return r.json(); });
    };
    var req = keys.length
      ? getJson(url).catch(function () { if (url === direct) throw new Error('taux'); return getJson(direct); })
      : Promise.resolve({ rates: {}, date: new Date().toISOString().slice(0, 10) });
    $('rates-info').textContent = t('rate.updating');
    req.then(function (j) {
      var eur = Object.assign({}, j.rates || {}, { EUR: 1, XOF: XOF_PER_EUR });
      need.forEach(function (c) {
        if (eur[c] > 0 && eur[S.base] > 0) {
          S.rates[c] = Math.round(eur[S.base] / eur[c] * 1e6) / 1e6;
          S.rateSrc[c] = typeof j.date === 'string' ? j.date.slice(0, 10) : '';
        }
      });
      $('rates-info').textContent = '';
      // Les taux sont recalculés sur chaque appareil : inutile de les envoyer au compte.
      saveLocal();
      if (D()) { renderRates(); update(); }
    }).catch(function () {
      $('rates-info').textContent = t('rate.failed');
      renderRates();
      if (D()) update();
    });
  }

  /* ---------- Saisie ---------- */

  function target(path) {
    var p = path.split('.');
    var o = D();
    if (!o) return null;
    for (var i = 0; i < p.length - 1; i++) {
      o = o[p[i]];
      if (o == null) return null;
    }
    return [o, p[p.length - 1]];
  }

  /* Décrit une valeur modifiée pour le journal. */
  function describe(path, oldValue) {
    var p = path.split('.'), field = p[p.length - 1], ref = target(path), obj = ref ? ref[0] : {};
    var label;
    if (field === 'label' || field === 'name') label = oldValue || t('empty');
    else if (p[2] === 'sal') label = D().accounts[+p[1]].name;
    else if (p.length === 3 && p[0] === 'accounts') label = obj.name;
    else label = obj.label || obj.name || t('empty');
    return { label: label, field: field };
  }
  function shown(field, v) {
    if (v === '' || v == null) return t('empty');
    if (field === 'cat') return I.cat(v);
    if (typeof v === 'number') return plain(v);
    return String(v);
  }
  function lineType(path) { var p = path.split('.'); return p[0] === 'accounts' ? p[2] : null; }

  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (!S || !el.dataset || !el.dataset.p || el.tagName === 'SELECT') return;
    var ref = target(el.dataset.p);
    el._old = ref ? ref[0][ref[1]] : '';
  });

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!S || !el.dataset || !D()) return;
    var res;
    if (el.dataset.rate) {
      res = parseRate(el.value);
      fieldError(el, res.err);
      if (res.err) return;
      S.rates[el.dataset.rate] = res.v;
      S.rateSrc[el.dataset.rate] = 'manuel';
      save('rate:' + el.dataset.rate); update();
      return;
    }
    if (el.dataset.plan !== undefined) {
      res = parseInput(el.value);
      fieldError(el, res.err);
      if (res.err) return;
      var plan = D().plan;
      if (res.empty) delete plan[el.dataset.plan]; else plan[el.dataset.plan] = res.v;
      save('plan:' + el.dataset.plan); update();
      return;
    }
    var p = el.dataset.p;
    if (!p || el.tagName === 'SELECT') return;
    var ref = target(p);
    if (!ref) return;
    if (el.hasAttribute('data-amount')) {
      res = parseInput(el.value);
      fieldError(el, res.err);
      if (res.err) return;
      ref[0][ref[1]] = res.v;
    } else ref[0][ref[1]] = el.value;
    save('p:' + S.cur + ':' + p); update();
  });

  document.addEventListener('change', function (e) {
    var el = e.target;
    if (!S || !el.dataset || !D()) return;
    if (el.id === 'plan-add' && el.value) {
      D().plan[el.value] = 0;
      log('planAdd', { cat: I.cat(el.value) });
      save(); update();
      var input = document.querySelector('[data-plan="' + CSS.escape(el.value) + '"]');
      if (input) input.focus();
      return;
    }
    if (el.dataset.once) {
      var r = target(el.dataset.once + '.x');
      if (!r) return;
      if (el.checked) r[0].once = true; else delete r[0].once;
      log('once', { label: r[0].label || t('empty'), on: el.checked ? 1 : 0 });
      save();
      return;
    }
    if (el.dataset.x13 !== undefined) {
      var a = D().accounts[+el.dataset.x13];
      if (a && a.sal) { if (el.checked) a.sal.x13 = true; else delete a.sal.x13; }
      log('x13', { acc: a.name, on: el.checked ? 1 : 0 });
      save(); update();
      return;
    }
    if (!el.dataset.p) return;
    var ref = target(el.dataset.p);
    if (!ref) return;
    if (el.tagName === 'SELECT') {
      var before = ref[0][ref[1]];
      ref[0][ref[1]] = el.value;
      if (ref[1] === 'cat') { delete ref[0].auto; if (ref[0].label) learn(ref[0].label, el.value); }
      if (before !== el.value) {
        var info = describe(el.dataset.p, before);
        log('edit', { label: info.label, field: info.field, from: before, to: el.value });
      }
      save();
      render();
      var again = document.querySelector('[data-p="' + el.dataset.p + '"]');
      if (again) again.focus();
      return;
    }
    // Une saisie refusée reste affichée avec son message ; le montant enregistré ne change pas.
    if (el.hasAttribute('data-amount') && parseInput(el.value).err) return;
    var now = ref[0][ref[1]];
    // Catégorie devinée d'après le libellé tant que la personne ne l'a pas choisie elle-même.
    if (ref[1] === 'label' && ref[0].auto && now) {
      var type = lineType(el.dataset.p);
      var g = learned(now) || guessCat(now, type);
      var list = type === 'inc' ? IN_CATS : outCats();
      if (g && list.indexOf(g) !== -1 && g !== ref[0].cat) {
        ref[0].cat = g;
        var sel = document.querySelector('[data-p="' + el.dataset.p.replace(/label$/, 'cat') + '"]');
        if (sel) sel.value = g;
        update();
        announce(t('cat.guessed', { cat: I.cat(g) }));
      }
    }
    if (el._old !== undefined && el._old !== now) {
      var d2 = describe(el.dataset.p, el._old);
      log('edit', { label: d2.label, field: d2.field, from: el._old, to: now });
      save();
    }
    el._old = now;
  });

  var toastTimer = null;
  function toast(text, withUndo) {
    var box = $('toast');
    box.innerHTML = '<span></span>' + (withUndo ? ' <button type="button" class="link inline" data-undo-toast>' + esc(t('undo.btn')) + '</button>' : '');
    box.firstChild.textContent = text;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.hidden = true; }, 8000);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!S || !b || !b.dataset) return;
    if (b.hasAttribute('data-undo-toast')) { $('toast').hidden = true; undo(); return; }
    var d = D(), ds = b.dataset, ref;
    if (ds.goto) { S.cur = ds.goto; saveLocal(); location.hash = ''; return; }
    if (ds.restore !== undefined) { restoreVersion(+ds.restore); return; }
    if (ds.dlversion !== undefined) { downloadVersion(+ds.dlversion); return; }
    if (!d) return;
    if (ds.fold !== undefined) {
      var acc0 = d.accounts[+ds.fold];
      if (folded[acc0.name]) delete folded[acc0.name]; else folded[acc0.name] = 1;
      saveFolded();
      var art = b.closest('.account'), body = $('ab' + ds.fold), on = !!folded[acc0.name];
      art.classList.toggle('folded', on);
      body.hidden = on;
      b.setAttribute('aria-expanded', String(!on));
      b.textContent = t(on ? 'acc.unfold' : 'acc.fold');
      return;
    }
    if (ds.del) {
      ref = target(ds.del);
      if (ref) {
        var item = ref[0][+ref[1]] || {};
        log('del', { label: item.label || item.name || t('empty') });
        ref[0].splice(+ref[1], 1);
        save(); render();
        toast(t('del.done', { label: item.label || item.name || t('empty') }), true);
      }
    } else if (ds.add) {
      var arr = d;
      ds.add.split('.').forEach(function (k) { arr = arr[k]; });
      var parts = ds.add.split('.'), last = parts[parts.length - 1];
      if (last === 'inc') arr.push({ label: '', amount: 0, cat: 'Autre revenu', auto: true });
      else if (last === 'out') arr.push({ label: '', amount: 0, cat: 'Divers', auto: true });
      else if (last === 'wish') arr.push({ label: '', amount: 0 });
      else arr.push({ name: '', pay: 0, bal: 0, cur: S.base });
      log('add.' + last, { acc: parts[0] === 'accounts' ? d.accounts[+parts[1]].name : '' });
      save(); render();
      var btn = document.querySelector('[data-add="' + ds.add + '"]');
      var prev = btn ? btn.previousElementSibling : null;
      if (prev && prev.classList.contains('row')) prev.querySelector('input').focus();
    } else if (ds.addsal !== undefined) {
      d.accounts[+ds.addsal].sal = { brut: 0, soc: 0, tax: 0 };
      log('salAdd', { acc: d.accounts[+ds.addsal].name });
      save(); render();
    } else if (ds.delsal !== undefined) {
      d.accounts[+ds.delsal].sal = null;
      log('salDel', { acc: d.accounts[+ds.delsal].name });
      save(); render();
      toast(t('salary.removed'), true);
    } else if (ds.delacc !== undefined) {
      var acc = d.accounts[+ds.delacc];
      if (confirm(t('confirm.delAcc', { name: acc.name || t('noName') }))) {
        d.accounts.splice(+ds.delacc, 1);
        log('accDel', { name: acc.name });
        save(); render();
        toast(t('acc.deleted', { name: acc.name || t('noName') }), true);
      }
    } else if (ds.newacc !== undefined) {
      d.accounts.push({ name: t('newAccount'), bank: '', cur: S.base, sal: null, inc: [], out: [] });
      log('accAdd');
      save(); render();
      var heads = document.querySelectorAll('.account-head input');
      if (heads.length >= 2) heads[heads.length - 2].focus();
    }
  });

  $('month').addEventListener('change', function (e) {
    if (MONTH_RE.test(e.target.value)) { S.cur = e.target.value; saveLocal(); render(); }
  });
  $('prev').addEventListener('click', function () { shiftMonth(-1); });
  $('next').addEventListener('click', function () { shiftMonth(1); });
  $('rates-refresh').addEventListener('click', function () { fetchRates(true); });
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);

  /* ---------- Fenêtre de choix (remplace les boîtes OK / Annuler) ---------- */

  function ask(title, text, buttons) {
    return new Promise(function (resolve) {
      var dlg = $('dialog');
      if (!dlg || typeof dlg.showModal !== 'function') { resolve(confirm(title + '\n\n' + text) ? buttons[0].value : buttons[1].value); return; }
      $('dialog-title').textContent = title;
      $('dialog-text').textContent = text;
      var box = $('dialog-actions');
      box.innerHTML = '';
      buttons.forEach(function (b, i) {
        var el = document.createElement('button');
        el.type = 'button';
        el.textContent = b.label;
        if (i === 0) el.className = 'primary';
        el.addEventListener('click', function () { dlg.close(); resolve(b.value); });
        box.appendChild(el);
      });
      // Échap ne choisit rien : il faut cliquer sur l'un des deux boutons.
      dlg.oncancel = function (ev) { ev.preventDefault(); };
      dlg.showModal();
      box.firstChild.focus();
    });
  }

  function downloadJson(data, name) {
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  /* Après un conflit, la version écartée reste téléchargeable et dans les versions de cet appareil. */
  function offerDiscarded(data) {
    saveVersion('discarded', data);
    var box = $('discarded');
    box.hidden = false;
    $('discarded-dl').onclick = function () { downloadJson(data, 'budget-mensuel-version-ecartee-' + new Date().toISOString().slice(0, 10) + '.json'); };
    $('discarded-close').onclick = function () { box.hidden = true; };
  }

  /* ---------- Réglages ---------- */

  function route() {
    var settings = location.hash === '#reglages';
    $('reglages').hidden = !settings;
    if (settings) {
      $('setup').hidden = true;
      $('budget').hidden = true;
      renderSettings();
      window.scrollTo(0, 0);
      return;
    }
    if (S) {
      $('setup').hidden = true;
      $('budget').hidden = false;
      safeRender();
    } else {
      showSetup();
    }
  }
  /* Si l'affichage échoue (données inattendues), on propose de revenir à une version enregistrée au lieu d'une page cassée. */
  function safeRender() {
    try { render(); $('broken').hidden = true; }
    catch (err) {
      $('broken').hidden = false;
      $('month-body').hidden = true;
      if (window.console) console.error(err);
    }
  }
  window.addEventListener('hashchange', route);
  $('back-budget').addEventListener('click', function (e) { e.preventDefault(); location.hash = ''; });
  $('broken-settings').addEventListener('click', function () { location.hash = '#reglages'; });

  function renderSettings() {
    $('set-lang').value = I.lang;
    $('set-theme').value = window.BMTheme ? window.BMTheme.get() : 'auto';
    $('set-budget-only').hidden = !S;
    $('set-history').hidden = !S;
    if (S) {
      fillCountrySelect($('set-country'), S.country);
      fillCurrencySelect($('set-cur'), S.base);
      $('set-advance').checked = S.opts.advance;
      $('set-threshold').value = S.opts.threshold === null ? '' : String(S.opts.threshold).replace('.', decSep());
      $('set-threshold-cur').textContent = S.base;
      renderHistory();
      renderLog();
    }
    renderVersions();
    renderAccountStatus();
  }

  function renderAccountStatus() {
    var st = $('account-status'), link = $('account-link');
    if (!API || Sync.unavailable) { st.textContent = t('account.unavailable'); link.parentNode.hidden = true; return; }
    link.parentNode.hidden = false;
    st.textContent = Sync.user ? t('account.in', { email: Sync.user.email }) : t('account.none');
    link.textContent = Sync.user ? t('account.link.in') : t('account.link.none');
  }

  function renderHistory() {
    var keys = Object.keys(S.months).sort().reverse();
    if (!keys.length) { $('history-months').innerHTML = '<p class="hint">' + t('hist.empty') + '</p>'; $('history-chart').innerHTML = ''; return; }
    var rows = keys.map(function (k) {
      var r = calc(S.months[k]);
      return '<tr' + (k === S.cur ? ' class="current"' : '') + '>' +
        '<td><button type="button" class="link inline" data-goto="' + k + '">' + esc(monthName(k)) + '</button></td>' +
        '<td>' + fmt(r.rev, S.base) + '</td><td>' + fmt(r.dep, S.base) + '</td>' +
        '<td class="' + (r.solde < 0 ? 'neg' : '') + '">' + fmt(r.solde, S.base) + '</td>' +
        '<td>' + fmt(r.sav, S.base) + '</td><td>' + fmt(r.debt, S.base) + '</td></tr>';
    }).join('');
    $('history-months').innerHTML = '<table class="history-table"><thead><tr>' +
      '<th scope="col">' + t('hist.month') + '</th><th scope="col">' + t('sum.net') + '</th><th scope="col">' + t('sum.out') + '</th>' +
      '<th scope="col">' + t('sum.bal') + '</th><th scope="col">' + t('sum.sav') + '</th><th scope="col">' + t('sum.debt') + '</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    historyChart(keys.slice(0, 12).reverse());
  }

  /* Courbe sur 12 mois : solde du mois, épargne et dettes, sur un seul axe (même devise).
     Les séries se distinguent par le trait (plein, tirets, pointillés) et par leur nom en bout de ligne. */
  function historyChart(keys) {
    var box = $('history-chart');
    if (keys.length < 2) { box.innerHTML = '<p class="hint">' + esc(t('hist.chartNeed')) + '</p>'; return; }
    var data = keys.map(function (k) { var r = calc(S.months[k]); return { m: k, solde: r.solde, sav: r.sav, debt: r.debt }; });
    var series = [
      { key: 'solde', label: t('sum.bal'), cls: 's-solde' },
      { key: 'sav', label: t('sum.sav'), cls: 's-sav' },
      { key: 'debt', label: t('sum.debt'), cls: 's-debt' }
    ];
    var W = 720, H = 260, L = 64, R = 130, T = 16, B = 34;
    var vals = [];
    data.forEach(function (d) { series.forEach(function (s) { vals.push(d[s.key]); }); });
    var lo = Math.min(0, Math.min.apply(null, vals)), hi = Math.max(0, Math.max.apply(null, vals));
    if (hi === lo) hi = lo + 1;
    var step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var x = function (i) { return L + (W - L - R) * (data.length === 1 ? 0.5 : i / (data.length - 1)); };
    var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };
    var short = new Intl.DateTimeFormat(I.lang, { month: 'short' });
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="hc-title" focusable="false"><title id="hc-title">' + esc(t('hist.chartTitle')) + '</title>';
    for (var v = lo; v <= hi + step / 2; v += step) {
      svg += '<line class="grid' + (Math.abs(v) < step / 1000 ? ' zero' : '') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
        '<text class="tick" x="' + (L - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(compact(v)) + '</text>';
    }
    data.forEach(function (d, i) {
      if (data.length <= 12) svg += '<text class="tick" x="' + x(i).toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(short.format(new Date(+d.m.slice(0, 4), +d.m.slice(5) - 1, 1))) + '</text>';
    });
    var ends = [];
    series.forEach(function (s) {
      var pts = data.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d[s.key]).toFixed(1); }).join(' ');
      svg += '<polyline class="line ' + s.cls + '" points="' + pts + '"/>';
      ends.push({ s: s, y: y(data[data.length - 1][s.key]) });
    });
    // Étiquettes en bout de ligne, écartées pour ne pas se chevaucher.
    ends.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    ends.forEach(function (e) { svg += '<text class="end-label" x="' + (W - R + 8) + '" y="' + (e.y + 4).toFixed(1) + '">' + esc(e.s.label) + '</text>'; });
    svg += '<line class="cross" id="hc-cross" x1="0" x2="0" y1="' + T + '" y2="' + (H - B) + '" visibility="hidden"/>';
    svg += '<rect class="hit" x="' + L + '" y="' + T + '" width="' + (W - L - R) + '" height="' + (H - T - B) + '"/></svg>';
    box.innerHTML = '<ul class="legend" aria-hidden="true">' + series.map(function (s) { return '<li><svg width="26" height="10"><line class="line ' + s.cls + '" x1="1" x2="25" y1="5" y2="5"/></svg>' + esc(s.label) + '</li>'; }).join('') + '</ul>' +
      '<div class="chart-area" tabindex="0" aria-label="' + esc(t('hist.chartKeys')) + '">' + svg + '<div class="tip" id="hc-tip" hidden></div></div>';
    var area = box.querySelector('.chart-area'), svgEl = area.querySelector('svg'), tip = $('hc-tip'), cross = $('hc-cross');
    var at = -1;
    function showAt(i) {
      at = Math.max(0, Math.min(data.length - 1, i));
      var d = data[at];
      cross.setAttribute('x1', x(at)); cross.setAttribute('x2', x(at)); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = '';
      var h = document.createElement('p'); h.className = 'tip-title'; h.textContent = monthName(d.m); tip.appendChild(h);
      series.forEach(function (s) {
        var p = document.createElement('p');
        var strong = document.createElement('strong'); strong.textContent = fmt(d[s.key], S.base);
        p.appendChild(strong); p.appendChild(document.createTextNode(' ' + s.label));
        tip.appendChild(p);
      });
      tip.hidden = false;
      var rect = svgEl.getBoundingClientRect(), px = x(at) / W * rect.width;
      tip.style.left = Math.min(Math.max(0, px + 12), rect.width - 190) + 'px';
    }
    function hide() { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); }
    area.addEventListener('pointermove', function (ev) {
      var rect = svgEl.getBoundingClientRect(), px = (ev.clientX - rect.left) / rect.width * W;
      var best = 0;
      data.forEach(function (d, i) { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      showAt(best);
    });
    area.addEventListener('pointerleave', hide);
    area.addEventListener('blur', hide);
    area.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); showAt(at < 0 ? data.length - 1 : at + (ev.key === 'ArrowRight' ? 1 : -1)); }
      else if (ev.key === 'Escape') hide();
    });
  }
  function niceStep(raw) {
    var p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function compact(v) {
    try { return new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(v); } catch (e) { return String(Math.round(v)); }
  }

  function logText(e) {
    var p = e.p || {};
    switch (e.k) {
      case 'edit':
        if (p.field === 'label' || p.field === 'name') {
          return p.from ? t('log.renamed', { from: p.from, to: p.to || t('empty') }) : t('log.named', { to: p.to });
        }
        return t('log.edit', { label: p.label, field: t('field.' + p.field), from: shown(p.field, p.from), to: shown(p.field, p.to) });
      case 'add.inc': case 'add.out': case 'add.sav': case 'add.debt': case 'add.wish':
        return t('log.' + e.k, { acc: p.acc });
      case 'country':
        return t('log.country', { country: cName(p.cc), cur: p.cur });
      case 'once': case 'x13':
        return t('log.' + e.k + (p.on ? '.on' : '.off'), p);
      default:
        return t('log.' + e.k, p);
    }
  }

  function renderLog() {
    var list = $('log-list');
    list.innerHTML = '';
    var entries = S.log.slice().reverse();
    if (!entries.length) {
      var li = document.createElement('li');
      li.textContent = t('log.empty');
      list.appendChild(li);
    }
    var df = new Intl.DateTimeFormat(locale(), { dateStyle: 'short', timeStyle: 'short' });
    entries.slice(0, logShown).forEach(function (e) {
      var li = document.createElement('li');
      var tm = document.createElement('time');
      tm.dateTime = new Date(e.t).toISOString();
      tm.textContent = df.format(new Date(e.t));
      var span = document.createElement('span');
      span.textContent = (e.m && MONTH_RE.test(e.m) ? monthName(e.m) + ' · ' : '') + logText(e);
      li.appendChild(tm); li.appendChild(span);
      list.appendChild(li);
    });
    $('log-more').hidden = entries.length <= logShown;
    $('log-clear').hidden = !entries.length;
  }

  function renderVersions() {
    var list = readVersions(), box = $('versions');
    if (!list.length) { box.innerHTML = '<p class="hint">' + esc(t('ver.empty')) + '</p>'; return; }
    var df = new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' });
    box.innerHTML = '<ul class="log-list versions">' + list.map(function (v, i) {
      var months = v.data && isObj(v.data.months) ? Object.keys(v.data.months).length : 0;
      return '<li><time datetime="' + new Date(v.t).toISOString() + '">' + esc(df.format(new Date(v.t))) + '</time><span>' + esc(t('ver.' + v.r) + ' · ' + t('ver.months', { n: months })) +
        ' <button type="button" class="link inline" data-restore="' + i + '">' + esc(t('ver.restore')) + '</button>' +
        ' <button type="button" class="link inline" data-dlversion="' + i + '">' + esc(t('ver.download')) + '</button></span></li>';
    }).join('') + '</ul>';
  }
  function restoreVersion(i) {
    var v = readVersions()[i];
    if (!v || !valid(v.data)) { announce(t('import.invalid')); return; }
    if (!confirm(t('ver.confirm'))) return;
    if (S) { hist.undo.push(snap()); hist.redo = []; saveVersion('beforeRestore'); }
    var keepLog = S ? S.log : [];
    S = normalize(JSON.parse(JSON.stringify(v.data)));
    S.log = keepLog;
    log('restore');
    hist.last = snap();
    updateUndo();
    ratesFetched = false; fmtCache = {};
    saveLocal(); Sync.changed();
    location.hash = '';
    route();
    toast(t('ver.restored'), true);
  }
  function downloadVersion(i) {
    var v = readVersions()[i];
    if (v) downloadJson(v.data, 'budget-mensuel-version-' + new Date(v.t).toISOString().slice(0, 10) + '.json');
  }

  $('log-more').addEventListener('click', function () { logShown += 30; renderLog(); });
  $('log-clear').addEventListener('click', function () {
    if (!confirm(t('confirm.clearLog'))) return;
    S.log = [];
    save(); renderLog();
  });

  $('set-lang').addEventListener('change', function (e) { I.setLang(e.target.value); });
  $('set-theme').addEventListener('change', function (e) { if (window.BMTheme) window.BMTheme.set(e.target.value); });
  document.addEventListener('themechange', function (e) { $('set-theme').value = e.detail; });
  document.addEventListener('langchange', function () {
    fmtCache = {};
    chartSig = '';
    if (!$('reglages').hidden) renderSettings();
    else if (S && !$('budget').hidden) safeRender();
    else if (!S) showSetup();
  });

  $('settings-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var cc = $('set-country').value, cur = $('set-cur').value;
    if (!C[cc] || !CUR_RE.test(cur)) return;
    var th = parseInput($('set-threshold').value, true);
    fieldError($('set-threshold'), th.err);
    if (th.err) { $('set-threshold').focus(); return; }
    if (cur !== S.base) { S.rates = {}; S.rateSrc = {}; ratesFetched = false; }
    if (cc !== S.country || cur !== S.base) log('country', { cc: cc, cur: cur });
    S.country = cc;
    S.base = cur;
    S.opts.advance = $('set-advance').checked;
    S.opts.threshold = th.empty ? null : th.v;
    fmtCache = {};
    save();
    location.hash = '';
  });
  $('set-country').addEventListener('change', function (e) {
    fillCurrencySelect($('set-cur'), C[e.target.value].cur);
  });

  /* ---------- Sauvegarde, import, effacement ---------- */

  /* Export et import : voir fichiers.js, qui utilise window.BudgetApp. */
  window.BudgetApp = {
    get state() { return S; },
    /* Remplace tout le budget (import, restauration) : l'ancien reste disponible avec « Annuler l'import ». */
    replace: function (data, kind) {
      var before = snap();
      if (S) saveVersion('beforeImport');
      var oldLog = S ? S.log : [];
      S = normalize(data);
      if (!S.log.length) S.log = oldLog;
      log('import', { kind: kind || '' });
      hist.undo.push(before); hist.redo = []; hist.last = snap(); hist.grouping = false;
      updateUndo();
      ratesFetched = false;
      fmtCache = {};
      saveLocal(); Sync.changed();
      location.hash = '';
      route();
      toast(t('import.undoable'), true);
    },
    /* Les imports qui complètent le budget passent par ici pour pouvoir être annulés. */
    beginChange: function () { hist.grouping = false; },
    calc: calc, monthName: monthName, fmt: fmt, plain: plain, locale: locale,
    countryName: cName, socLabel: function () { return cLabel('soc'); }, taxLabel: function () { return cLabel('tax'); },
    outCats: outCats, IN_CATS: IN_CATS, log: log,
    save: function () { save(); if (S && !$('budget').hidden) safeRender(); else if (S && !$('reglages').hidden) renderSettings(); },
    ensureBlank: ensureBlank, valid: valid, migrate: migrate, normalize: normalize,
    learned: learned, learn: learn, learnKey: learnKey, toast: toast
  };

  $('clear-month').addEventListener('click', function () {
    if (!S || !D() || !confirm(t('confirm.clearMonth', { month: monthName(S.cur) }))) return;
    saveVersion('beforeClear');
    var d = D();
    d.accounts.forEach(function (a) { a.inc = []; a.out = []; if (a.sal) a.sal = { brut: 0, soc: 0, tax: 0 }; });
    d.sav.forEach(function (r) { r.pay = 0; });
    d.debt.forEach(function (r) { r.pay = 0; });
    log('clearMonth');
    save();
    location.hash = '';
    toast(t('month.cleared'), true);
  });

  $('clear-all').addEventListener('click', function () {
    var withAccount = !!Sync.user;
    if (!confirm(t(withAccount ? 'confirm.clearAllAccount' : 'confirm.clearAll'))) return;
    try { localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY); localStorage.removeItem(VERSIONS_KEY); } catch (e) { /* ignoré */ }
    S = null;
    resetHistory();
    ratesFetched = false;
    if (withAccount) Sync.deleteRemote();
    location.hash = '';
    route();
  });

  /* ---------- Synchronisation avec le compte ---------- */

  var Sync = {
    user: null, unavailable: false, timer: null, busy: false, retry: 0, retryTimer: null,
    meta: (function () {
      try { var m = JSON.parse(localStorage.getItem(SYNC_KEY)); if (m && typeof m === 'object') return m; } catch (e) { /* ignoré */ }
      return { email: null, syncedAt: 0, dirty: false };
    })(),
    saveMeta: function () { try { localStorage.setItem(SYNC_KEY, JSON.stringify(this.meta)); } catch (e) { /* ignoré */ } },
    status: function (key) { var el = $('sync-status'); if (el) el.textContent = key ? t(key) : ''; this.lastStatus = key; },
    call: function (method, path, body) {
      return fetchTimeout(API + path, 8000, {
        method: method, credentials: 'include',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
    },
    init: function () {
      var self = this;
      if (!API) { self.status('sync.local'); return; }
      self.status(self.meta.email ? 'sync.saving' : 'sync.local');
      self.call('GET', '/auth/me').then(function (r) {
        if (r.status === 503) { self.unavailable = true; return null; }
        return r.ok ? r.json() : null;
      }).then(function (j) {
        self.user = j && j.user ? j.user : null;
        if (!self.user) {
          self.status(self.meta.email ? 'sync.loggedOut' : 'sync.local');
          if (!$('reglages').hidden) renderAccountStatus();
          return;
        }
        if (self.meta.email !== self.user.email) {
          self.meta = { email: self.user.email, syncedAt: 0, dirty: !!S, linking: true };
          self.saveMeta();
        }
        if (!$('reglages').hidden) renderAccountStatus();
        return self.pull();
      }).catch(function () { self.status(self.meta.email ? 'sync.offline' : 'sync.local'); });
      window.addEventListener('online', function () { if (self.meta.dirty) self.push(); });
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && self.user && !self.meta.dirty && !self.busy) self.pull();
      });
    },
    adopt: function (data, updatedAt) {
      if (!valid(data)) return;
      var keepMonth = S && S.cur;
      S = normalize(data);
      if (keepMonth) S.cur = keepMonth;
      this.meta.syncedAt = updatedAt;
      this.meta.dirty = false;
      this.meta.linking = false;
      this.saveMeta();
      saveLocal();
      resetHistory();
      ratesFetched = false;
      route();
    },
    pull: function () {
      var self = this;
      self.busy = true;
      return self.call('GET', '/budget').then(function (r) {
        if (r.status === 401) { self.user = null; self.status('sync.loggedOut'); return null; }
        if (!r.ok) throw new Error('budget');
        return r.json();
      }).then(function (j) {
        self.busy = false;
        if (!j) return;
        var m = self.meta;
        if (!j.data) {
          if (S) { m.dirty = true; self.saveMeta(); self.push(); } else self.status('sync.saved');
          return;
        }
        if (!S) { self.adopt(j.data, j.updated_at); self.status('sync.saved'); return; }
        if (m.linking) { self.resolve(j.data, j.updated_at, true); return; }
        if (j.updated_at === m.syncedAt) {
          if (m.dirty) self.push(); else self.status('sync.saved');
          return;
        }
        if (!m.dirty) { self.adopt(j.data, j.updated_at); self.status('sync.saved'); return; }
        self.resolve(j.data, j.updated_at, false);
      }).catch(function () { self.busy = false; self.status('sync.offline'); });
    },
    /* Deux versions différentes : la personne choisit avec deux boutons nommés ; l'autre version reste téléchargeable. */
    resolve: function (data, updatedAt, first) {
      var self = this;
      self.status('sync.choose');
      ask(t(first ? 'sync.first.title' : 'sync.conflict.title'), t(first ? 'sync.first.text' : 'sync.conflict.text'), [
        { label: t('sync.keepAccount'), value: 'account' },
        { label: t('sync.keepDevice'), value: 'device' }
      ]).then(function (choice) {
        if (choice === 'account') {
          var mine = S ? JSON.parse(JSON.stringify(S)) : null;
          self.adopt(data, updatedAt);
          if (mine) offerDiscarded(mine);
          self.status('sync.saved');
        } else {
          if (valid(data)) offerDiscarded(data);
          self.meta.syncedAt = updatedAt; self.meta.dirty = true; self.meta.linking = false; self.saveMeta(); self.push();
        }
      });
    },
    changed: function () {
      if (!this.meta.email && !this.user) return;
      this.meta.dirty = true;
      this.saveMeta();
      if (!this.user) return;
      var self = this;
      clearTimeout(self.timer);
      self.status('sync.saving');
      self.timer = setTimeout(function () { self.push(); }, 1500);
    },
    /* Après une erreur, nouvel essai automatique : 15 s, 30 s, 1 min… jusqu'à 5 min. */
    later: function (key) {
      var self = this;
      self.status(key);
      clearTimeout(self.retryTimer);
      self.retry = Math.min(300000, self.retry ? self.retry * 2 : 15000);
      self.retryTimer = setTimeout(function () { if (self.meta.dirty) self.push(); }, self.retry);
    },
    push: function () {
      var self = this;
      if (!self.user || !S) return;
      if (self.busy) { clearTimeout(self.timer); self.timer = setTimeout(function () { self.push(); }, 1000); return; }
      self.busy = true;
      self.status('sync.saving');
      var sentAt = Date.now();
      self.lastSent = sentAt;
      self.call('PUT', '/budget', { data: S, base: self.meta.syncedAt }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; });
      }).then(function (x) {
        self.busy = false;
        if (x.r.status === 200) {
          self.retry = 0;
          self.meta.syncedAt = x.j.updated_at;
          if (self.lastSent === sentAt && !self.timer) self.meta.dirty = false;
          self.meta.linking = false;
          self.saveMeta();
          self.status(self.meta.dirty ? 'sync.saving' : 'sync.saved');
        } else if (x.r.status === 409) {
          self.resolve(x.j.data, x.j.updated_at, false);
        } else if (x.r.status === 401) {
          self.user = null; self.status('sync.loggedOut');
        } else if (x.r.status === 413) {
          self.status('sync.tooBig');
        } else if (x.r.status === 429) {
          self.later('sync.tooMany');
        } else {
          self.later('sync.serverError');
        }
      }).catch(function () { self.busy = false; self.later('sync.offline'); });
      self.timer = null;
    },
    deleteRemote: function () {
      var self = this;
      self.call('DELETE', '/budget', { confirm: true }).then(function () {
        self.meta = { email: self.user ? self.user.email : null, syncedAt: 0, dirty: false };
        self.saveMeta();
        self.status('sync.saved');
      }).catch(function () { self.status('sync.offline'); });
    }
  };

  /* ---------- Démarrage ---------- */

  $('storage-warning').hidden = storageOK;
  hist.last = snap();
  updateUndo();
  route();
  Sync.init();
})();
