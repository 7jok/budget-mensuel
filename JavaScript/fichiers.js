/* Import et export de fichiers, entièrement dans le navigateur.
   Export : JSON (sauvegarde), Excel (.xlsx), CSV, PDF, Word (.docx), Markdown.
   Import : JSON, Excel, CSV, PDF, Markdown.
     - un fichier exporté par Budget mensuel restaure le budget complet ;
     - un relevé bancaire (CSV, Excel ou PDF) ajoute des lignes après un aperçu. */
(function () {
  'use strict';
  var A = window.BudgetApp;
  var I = window.I18N, t = I.t;
  var $ = function (id) { return document.getElementById(id); };
  var enc = new TextEncoder();
  var script = document.currentScript;
  var base = script ? script.src.replace(/JavaScript\/fichiers\.js.*$/, '') : '/';

  /* ================= Outils ================= */

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function download(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function b64(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { var bin = atob(s.replace(/\s+/g, '')); var u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function backupB64() { return b64(enc.encode(JSON.stringify(A.state))); }
  function parseBackupB64(s) { try { return JSON.parse(new TextDecoder().decode(unb64(s))); } catch (e) { return null; } }
  /* Empreinte du texte visible : si le fichier a été modifié après l'export, la copie intégrée n'est plus utilisée. */
  function fnv(str) { var h = 0x811c9dc5; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ('0000000' + h.toString(16)).slice(-8); }
  function textSum(text) { return fnv(String(text).replace(/\s+/g, '')); }
  function docxSum(xml) {
    var ts = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 't'), s = '';
    for (var i = 0; i < ts.length; i++) s += ts[i].textContent;
    return textSum(s);
  }

  /* ================= ZIP (pour .xlsx et .docx) ================= */

  var CRC = (function () {
    var tb = [];
    for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; }
    return tb;
  })();
  function crc32(u) { var c = -1; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

  function zip(files) {
    var parts = [], central = [], offset = 0;
    var d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var size = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]));
  }

  function inflate(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('inflate'));
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([data]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  function unzip(buf) {
    var u = new Uint8Array(buf), v = new DataView(buf);
    var eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) { if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) return Promise.reject(new Error('zip'));
    var count = v.getUint16(eocd + 10, true), p = v.getUint32(eocd + 16, true), out = {}, jobs = [];
    for (var n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
      var nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
      var loc = v.getUint32(p + 42, true);
      var name = new TextDecoder().decode(u.subarray(p + 46, p + 46 + nlen));
      var start = loc + 30 + v.getUint16(loc + 26, true) + v.getUint16(loc + 28, true);
      var raw = u.subarray(start, start + csize);
      (function (name, method, raw) {
        jobs.push((method === 8 ? inflate(raw) : Promise.resolve(raw)).then(function (d) { out[name] = d; }));
      })(name, method, raw);
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(jobs).then(function () { return out; });
  }

  /* ================= Excel (.xlsx) ================= */

  function colName(i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function xmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }

  function xlsx(sheets) {
    var files = [];
    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '</Types>';
    files.push({ name: '[Content_Types].xml', data: ct });
    files.push({ name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' });
    files.push({ name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets.map(function (s, i) { return '<sheet name="' + xmlEsc(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '"' + (s.hidden ? ' state="hidden"' : '') + ' r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' });
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' });
    files.push({ name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' });
    sheets.forEach(function (s, si) {
      var cols = s.widths ? '<cols>' + s.widths.map(function (w, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"' + (s.textCols && s.textCols.indexOf(i) !== -1 ? ' style="3"' : '') + '/>'; }).join('') + '</cols>' : '';
      var rows = s.rows.map(function (row, r) {
        return '<row r="' + (r + 1) + '">' + row.map(function (v, c) {
          if (v === null || v === undefined || v === '') return '';
          var ref = colName(c) + (r + 1);
          if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '" s="2"><v>' + v + '</v></c>';
          var st = r === 0 && s.header ? ' s="1"' : (s.textCols && s.textCols.indexOf(c) !== -1 ? ' s="3"' : '');
          return '<c r="' + ref + '" t="inlineStr"' + st + '><is><t xml:space="preserve">' + xmlEsc(v) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      var pane = s.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
      var dv = s.validations && s.validations.length ? '<dataValidations count="' + s.validations.length + '">' + s.validations.map(function (v) {
        return '<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="warning" sqref="' + v.sqref + '"><formula1>' + xmlEsc(v.formula) + '</formula1></dataValidation>';
      }).join('') + '</dataValidations>' : '';
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + pane + cols + '<sheetData>' + rows + '</sheetData>' + dv + '</worksheet>' });
    });
    return zip(files);
  }

  function readXlsx(buf) {
    return unzip(buf).then(function (files) {
      var dec = new TextDecoder();
      var parse = function (name) { return files[name] ? new DOMParser().parseFromString(dec.decode(files[name]), 'application/xml') : null; };
      var shared = [];
      var ss = parse('xl/sharedStrings.xml');
      if (ss) Array.prototype.forEach.call(ss.getElementsByTagName('si'), function (si) {
        shared.push(Array.prototype.map.call(si.getElementsByTagName('t'), function (x) { return x.textContent; }).join(''));
      });
      var wb = parse('xl/workbook.xml'), rels = parse('xl/_rels/workbook.xml.rels');
      var target = {};
      if (rels) Array.prototype.forEach.call(rels.getElementsByTagName('Relationship'), function (r) { target[r.getAttribute('Id')] = r.getAttribute('Target'); });
      var sheets = [];
      Array.prototype.forEach.call(wb.getElementsByTagName('sheet'), function (s) {
        var rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var path = (target[rid] || '').replace(/^\//, '');
        if (path && path.indexOf('xl/') !== 0) path = 'xl/' + path;
        var doc = parse(path);
        if (!doc) return;
        var rows = [];
        Array.prototype.forEach.call(doc.getElementsByTagName('row'), function (row) {
          var r = (+row.getAttribute('r') || rows.length + 1) - 1, out = [];
          Array.prototype.forEach.call(row.getElementsByTagName('c'), function (c, k) {
            var ref = c.getAttribute('r'), ci = k;
            if (ref) { var letters = ref.replace(/\d+/g, ''); ci = 0; for (var j = 0; j < letters.length; j++) ci = ci * 26 + letters.charCodeAt(j) - 64; ci--; }
            var tp = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0], val;
            if (tp === 's') val = shared[+(vEl && vEl.textContent)] || '';
            else if (tp === 'inlineStr') val = Array.prototype.map.call(c.getElementsByTagName('t'), function (x) { return x.textContent; }).join('');
            else if (tp === 'str' || tp === 'b') val = vEl ? vEl.textContent : '';
            else val = vEl ? Number(vEl.textContent) : '';
            out[ci] = val;
          });
          for (var z = 0; z < out.length; z++) if (out[z] === undefined) out[z] = '';
          rows[r] = out;
        });
        for (var q = 0; q < rows.length; q++) if (!rows[q]) rows[q] = [];
        sheets.push({ name: s.getAttribute('name'), rows: rows });
      });
      return sheets;
    });
  }

  /* ================= CSV ================= */

  /* Virgule décimale quand le pays l'utilise : Excel en français (France, Belgique) lit alors les montants comme des nombres. */
  function commaDecimal() {
    try { return new Intl.NumberFormat(A.locale()).format(1.5).indexOf(',') !== -1; } catch (e) { return false; }
  }
  function csv(rows) {
    var comma = A.state ? commaDecimal() : false;
    var out = rows.map(function (r) {
      return r.map(function (v) {
        if (v === null || v === undefined) return '';
        var s = typeof v === 'number' ? (comma ? String(v).replace('.', ',') : String(v)) : String(v);
        return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');
    return '﻿' + out + '\r\n';
  }

  function decodeText(buf) {
    var u = new Uint8Array(buf);
    var text = new TextDecoder('utf-8').decode(u);
    if (text.indexOf('�') !== -1) { try { text = new TextDecoder('windows-1252').decode(u); } catch (e) { /* ignoré */ } }
    return text.replace(/^﻿/, '');
  }

  function parseCsv(text) {
    var first = text.split(/\r?\n/)[0] || '';
    var counts = [';', ',', '\t'].map(function (d) { return [d, first.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; });
    var d = counts[0][0], rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
  }

  /* ================= Tableau standard (Excel, CSV) ================= */

  var HEAD = {
    fr: ['Mois', 'Section', 'Compte', 'Banque', 'Devise', 'Libellé', 'Catégorie', 'Montant', 'Solde', 'Date opération', 'Ponctuelle'],
    en: ['Month', 'Section', 'Account', 'Bank', 'Currency', 'Label', 'Category', 'Amount', 'Balance', 'Transaction date', 'One-off'],
    de: ['Monat', 'Abschnitt', 'Konto', 'Bank', 'Währung', 'Bezeichnung', 'Kategorie', 'Betrag', 'Saldo', 'Buchungsdatum', 'Einmalig']
  };
  var SECT = {
    fr: { account: 'Compte', brut: 'Salaire brut', soc: 'Cotisations', tax: 'Impôt retenu', inc: 'Revenu', out: 'Dépense', sav: 'Épargne', debt: 'Dette', wish: 'Envie', plan: 'Budget prévu' },
    en: { account: 'Account', brut: 'Gross salary', soc: 'Contributions', tax: 'Tax withheld', inc: 'Income', out: 'Expense', sav: 'Savings', debt: 'Debt', wish: 'Wish', plan: 'Planned budget' },
    de: { account: 'Konto', brut: 'Bruttolohn', soc: 'Abzüge', tax: 'Quellensteuer', inc: 'Einnahme', out: 'Ausgabe', sav: 'Ersparnis', debt: 'Schuld', wish: 'Wunsch', plan: 'Geplantes Budget' }
  };
  var YES = { fr: 'oui', en: 'yes', de: 'ja' };
  var X13_LABEL = { fr: '13e salaire inclus', en: '13th salary included', de: '13. Monatslohn inbegriffen' };
  /* Textes des fichiers créés (noms d'onglets, exemples des modèles), par langue. */
  var L10N = {
    fr: { lines: 'Lignes', monthly: 'Mois par mois', help: 'Aide', lists: 'Listes', keyHead: ['Clé', 'Valeur', 'Description'], base: 'Devise principale',
      advance: 'Faire avancer les soldes en reprenant un mois (1 = oui)', threshold: "Seuil d'alerte du solde", file: 'modele-budget-mensuel',
      listHead: ['Sections', 'Catégories', 'Devises'], acc: 'Compte courant', bank: 'Ma banque',
      ex: ['Allocations familiales', 'Loyer', 'Courses', 'Assurance maladie', 'Compte épargne', 'Crédit voiture', 'Vélo'] },
    en: { lines: 'Lines', monthly: 'Month by month', help: 'Help', lists: 'Lists', keyHead: ['Key', 'Value', 'Description'], base: 'Main currency',
      advance: 'Move balances forward when copying a month (1 = yes)', threshold: 'Balance alert threshold', file: 'budget-mensuel-template',
      listHead: ['Sections', 'Categories', 'Currencies'], acc: 'Current account', bank: 'My bank',
      ex: ['Child benefit', 'Rent', 'Groceries', 'Health insurance', 'Savings account', 'Car loan', 'Bike'] },
    de: { lines: 'Zeilen', monthly: 'Monat für Monat', help: 'Hilfe', lists: 'Listen', keyHead: ['Schlüssel', 'Wert', 'Beschreibung'], base: 'Hauptwährung',
      advance: 'Salden beim Übernehmen eines Monats fortschreiben (1 = ja)', threshold: 'Warnschwelle für den Saldo', file: 'vorlage-budget-mensuel',
      listHead: ['Abschnitte', 'Kategorien', 'Währungen'], acc: 'Privatkonto', bank: 'Meine Bank',
      ex: ['Kinderzulage', 'Miete', 'Einkäufe', 'Krankenkasse', 'Sparkonto', 'Autokredit', 'Velo'] }
  };
  function L(lang) { return L10N[lang || I.lang] || L10N.en; }
  var SHEETS_SKIP = ['Infos', 'Listes', 'Lists', 'Listen', 'Aide', 'Help', 'Hilfe'];
  function langOf(table, lang) { return table[lang] || table.en; }
  function sectionKey(label) {
    var l = String(label).trim().toLowerCase();
    for (var lang in SECT) for (var k in SECT[lang]) if (SECT[lang][k].toLowerCase() === l || k === l) return k;
    return null;
  }

  function tableRows(lang) {
    var S = A.state, H = langOf(HEAD, lang), X = langOf(SECT, lang), yes = langOf(YES, lang), rows = [H];
    var line = function (m, sec, a, r) { return [m, sec, a.name, '', a.cur, r.label, I.cat(r.cat), r.amount || 0, null, r.d || '', r.once ? yes : '']; };
    Object.keys(S.months).sort().forEach(function (m) {
      var d = S.months[m];
      d.accounts.forEach(function (a) {
        rows.push([m, X.account, a.name, a.bank || '', a.cur, '', '', null, null, '', '']);
        if (a.sal) {
          rows.push([m, X.brut, a.name, '', a.cur, a.sal.x13 ? langOf(X13_LABEL, lang) : '', '', a.sal.brut || 0, null, '', '']);
          rows.push([m, X.soc, a.name, '', a.cur, '', '', a.sal.soc || 0, null, '', '']);
          rows.push([m, X.tax, a.name, '', a.cur, '', '', a.sal.tax || 0, null, '', '']);
        }
        a.inc.forEach(function (r) { rows.push(line(m, X.inc, a, r)); });
        a.out.forEach(function (r) { rows.push(line(m, X.out, a, r)); });
      });
      d.sav.forEach(function (r) { rows.push([m, X.sav, '', '', r.cur, r.name, '', r.pay || 0, r.bal || 0, '', '']); });
      d.debt.forEach(function (r) { rows.push([m, X.debt, '', '', r.cur, r.name, '', r.pay || 0, r.bal || 0, '', '']); });
      d.wish.forEach(function (r) { rows.push([m, X.wish, '', '', S.base, r.label, '', r.amount || 0, null, '', '']); });
      Object.keys(d.plan || {}).forEach(function (c) { rows.push([m, X.plan, '', '', S.base, '', I.cat(c), d.plan[c] || 0, null, '', '']); });
    });
    return rows;
  }

  /* ---------- Interprétation souple : sections, mois, catégories ---------- */

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[’`´]/g, "'").replace(/\s+/g, ' ').trim();
  }

  // Mots reconnus pour chaque section (sans accents, en minuscules).
  var SECTION_WORDS = {
    account: ['compte', 'comptes', 'account', 'accounts', 'konto', 'konten', 'bankkonto', 'compte bancaire', 'bank account'],
    brut: ['salaire', 'salaire brut', 'brut', 'salaire mensuel', 'salary', 'gross salary', 'gross', 'gross pay', 'lohn', 'bruttolohn', 'gehalt', 'bruttogehalt', 'brutto', 'paie', 'paye'],
    net: ['salaire net', 'net', 'net salary', 'net pay', 'nettolohn', 'nettogehalt', 'netto', 'salaire verse'],
    soc: ['cotisations', 'cotisation', 'cotisations sociales', 'charges sociales', 'deductions', 'deductions sociales', 'retenues', 'contributions', 'social contributions', 'social security', 'avs', 'lpp', 'sozialabgaben', 'abzuge', 'sozialabzuge', 'beitrage', 'sozialversicherung', 'ahv'],
    tax: ['impot', 'impots', 'impot retenu', 'impot a la source', 'prelevement a la source', 'tax', 'taxes', 'tax withheld', 'withholding tax', 'income tax', 'steuer', 'steuern', 'quellensteuer', 'lohnsteuer'],
    inc: ['revenu', 'revenus', 'income', 'incomes', 'entree', 'entrees', 'recette', 'recettes', 'gain', 'gains', 'rentree', 'rentrees', 'einnahmen', 'einnahme', 'einkommen', 'credit recu'],
    out: ['depense', 'depenses', 'expense', 'expenses', 'sortie', 'sorties', 'charge', 'charges', 'frais', 'cost', 'costs', 'spending', 'ausgaben', 'ausgabe', 'kosten', 'achat', 'achats'],
    sav: ['epargne', 'epargnes', 'savings', 'saving', 'placement', 'placements', 'economies', 'sparen', 'ersparnis', 'ersparnisse'],
    debt: ['dette', 'dettes', 'debt', 'debts', 'credit', 'credits', 'pret', 'prets', 'emprunt', 'emprunts', 'loan', 'loans', 'leasing', 'schulden', 'schuld', 'kredit', 'kredite', 'darlehen'],
    plan: ['budget prevu', 'budgets prevus', 'planned budget', 'budget plan', 'geplantes budget', 'budgetplan', 'plafond', 'plafonds'],
    wish: ['wunsch', 'wunsche', 'wunschliste', 'envie', 'envies', "envies d'achat", "envie d'achat", 'wish', 'wishes', 'wish list', 'wishlist', 'souhait', 'souhaits', 'achat prevu', 'achats prevus', 'projet', 'projets']
  };
  var WORD_TO_SECTION = {};
  Object.keys(SECTION_WORDS).forEach(function (k) { SECTION_WORDS[k].forEach(function (w) { WORD_TO_SECTION[w] = k; }); });
  function sectionOf(label) {
    var n = norm(label).replace(/[:=*#_]/g, '').replace(/\s*\(.*\)$/, '').trim();
    return WORD_TO_SECTION[n] || null;
  }

  var MONTHS = {
    janvier: 1, janv: 1, january: 1, jan: 1, fevrier: 2, fevr: 2, fev: 2, february: 2, feb: 2, mars: 3, march: 3, mar: 3,
    avril: 4, avr: 4, april: 4, apr: 4, mai: 5, may: 5, juin: 6, june: 6, jun: 6, juillet: 7, juil: 7, july: 7, jul: 7,
    aout: 8, august: 8, aug: 8, septembre: 9, sept: 9, sep: 9, september: 9, octobre: 10, oct: 10, october: 10,
    novembre: 11, nov: 11, november: 11, decembre: 12, dec: 12, december: 12,
    januar: 1, februar: 2, marz: 3, maerz: 3, mrz: 3, juni: 6, juli: 7, oktober: 10, okt: 10, dezember: 12, dez: 12
  };
  /* Accepte 2026-10, 2026-10-05, 10.2026, 10/2026, 05.10.2026, « octobre 2026 », « Oct 2026 », une date Excel. */
  function parseMonth(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 7);
      return null;
    }
    var s = norm(v).replace(/\./g, '.'), m;
    if ((m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s)) && +m[2] >= 1 && +m[2] <= 12) return m[1] + '-' + pad(m[2]);
    if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(s)) && +m[1] >= 1 && +m[1] <= 12) return m[2] + '-' + pad(m[1]);
    var d = parseDate(s);
    if (d) return d.slice(0, 7);
    if ((m = /^([a-z]+)\.?\s+(\d{4})$/.exec(s)) && MONTHS[m[1]]) return m[2] + '-' + pad(MONTHS[m[1]]);
    if ((m = /^(\d{4})\s+([a-z]+)\.?$/.exec(s)) && MONTHS[m[2]]) return m[1] + '-' + pad(MONTHS[m[2]]);
    return null;
  }

  /* Catégorie : nom exact (français ou anglais), sans tenir compte des accents ni des majuscules, ou début du nom. */
  function matchCategory(text, section) {
    var list = section === 'inc' ? A.IN_CATS : A.outCats();
    var n = norm(text);
    if (!n) return '';
    var all = list.map(function (c) { return [c, norm(c), norm(I.catEn(c)), norm(I.catDe(c))]; });
    var any = function (a, fn) { return fn(a[1]) || fn(a[2]) || fn(a[3]); };
    for (var i = 0; i < all.length; i++) if (any(all[i], function (x) { return x === n; })) return all[i][0];
    for (i = 0; i < all.length; i++) if (n.length >= 4 && any(all[i], function (x) { return x.indexOf(n) === 0; })) return all[i][0];
    for (i = 0; i < all.length; i++) if (n.length >= 5 && any(all[i], function (x) { return x.indexOf(n) !== -1; })) return all[i][0];
    return '';
  }

  var CURRENCY_WORDS = { '€': 'EUR', 'euro': 'EUR', 'euros': 'EUR', '$': 'USD', 'us$': 'USD', 'dollar': 'USD', 'dollars': 'USD', '£': 'GBP', 'fr': 'CHF', 'frs': 'CHF', 'francs': 'CHF', 'franc': 'CHF', 'chf': 'CHF', 'sfr': 'CHF', 'fcfa': 'XOF', 'cfa': 'XOF', 'dh': 'MAD', 'mad': 'MAD', 'dt': 'TND' };
  var ISO = {};
  (function () {
    var list = [];
    try { if (Intl.supportedValuesOf) list = Intl.supportedValuesOf('currency'); } catch (e) { list = []; }
    list.concat(window.BUDGET_CURRENCIES || [], window.BUDGET_ECB || []).forEach(function (c) { ISO[c] = 1; });
  })();
  /* Code ISO connu (« UBS » ou « BCV » ne sont pas des devises) ou mot courant (« fr », « € », « euros »). */
  function parseCurrency(v) {
    var s = String(v || '').trim();
    if (/^[A-Za-z]{3}$/.test(s) && ISO[s.toUpperCase()]) return s.toUpperCase();
    return CURRENCY_WORDS[norm(s)] || '';
  }

  /* ---------- Brouillon d'import : ce qui sera ajouté, avec les avertissements ---------- */

  function isYes(v) { return /^(oui|yes|ja|x|1|true|vrai)$/i.test(String(v == null ? '' : v).trim()); }
  function Draft(name, fromExport, exact) {
    this.name = name;
    this.fromExport = !!fromExport;
    this.exact = !!exact || !!fromExport;
    this.months = {};
    this.salSet = {};
    this.warnings = [];
    this.nets = [];
    this.count = 0;
    this.infos = null;
    var S = A.state;
    this.defaultMonth = S ? S.cur : thisMonth();
    this.base = S ? S.base : ($('setup-cur') && $('setup-cur').value) || 'EUR';
  }
  Draft.prototype.warn = function (row, key, vars) { this.warnings.push((row ? t('imp.row', { n: row }) + ' ' : '') + t(key, vars)); };
  Draft.prototype.month = function (m) { return this.months[m] || (this.months[m] = { accounts: [], sav: [], debt: [], wish: [], plan: {} }); };
  Draft.prototype.account = function (m, name, bank, cur) {
    var d = this.month(m), S = A.state;
    if (!name) {
      if (d.accounts.length) return d.accounts[0];
      var existing = S && S.months[m] && S.months[m].accounts[0];
      var fallback = existing || (S && S.months[S.cur] && S.months[S.cur].accounts[0]);
      name = fallback ? fallback.name : t('mainAccount');
      if (!cur && fallback) cur = fallback.cur;
    }
    var a = d.accounts.filter(function (x) { return norm(x.name) === norm(name); })[0];
    if (!a) { a = { name: String(name).slice(0, 60), bank: '', cur: cur || this.base, sal: null, inc: [], out: [] }; d.accounts.push(a); }
    if (bank) a.bank = String(bank).slice(0, 60);
    if (cur) a.cur = cur;
    return a;
  };
  /* item : { row, month, section, account, bank, cur, label, cat, amount, balance } (valeurs brutes) */
  Draft.prototype.add = function (it) {
    var sec = it.section;
    if (!sec) { this.warn(it.row, 'imp.noSection', { text: it.sectionText || it.label || '' }); return; }
    var m = this.defaultMonth;
    if (it.month !== undefined && it.month !== null && String(it.month).trim() !== '') {
      var pm = parseMonth(it.month);
      if (pm) m = pm; else this.warn(it.row, 'imp.badMonth', { text: it.month, month: A.monthName(m) });
    }
    var cur = parseCurrency(it.cur), self = this;
    if (sec === 'account') { this.account(m, String(it.account || it.label || '').trim(), it.bank, cur); this.count++; return; }
    /* Devise d'une ligne : elle fixe celle d'un compte nouveau, sinon elle est seulement signalée si elle diffère. */
    var lineAccount = function () {
      var d = self.month(m), before = d.accounts.length;
      var a = self.account(m, String(it.account || '').trim(), it.bank, before ? '' : cur);
      var S = A.state, known = S && [S.months[m], S.months[S.cur]].filter(Boolean).map(function (x) { return x.accounts.filter(function (y) { return norm(y.name) === norm(a.name); })[0]; }).filter(Boolean)[0];
      if (d.accounts.length > before && known) a.cur = known.cur;
      if (d.accounts.length > before && cur && !known) a.cur = cur;
      else if (cur && cur !== a.cur) self.warn(it.row, 'imp.curMismatch', { text: String(it.label || it.sectionText || '').slice(0, 60), cur: cur, account: a.name, acc: a.cur });
      return a;
    };
    var amount = parseAmount(it.amount);
    if (amount === null) { this.warn(it.row, 'imp.noAmount', { text: it.label || it.sectionText || '' }); return; }
    amount = Math.abs(amount);
    var label = String(it.label || '').trim().slice(0, 80);
    if (sec === 'brut' || sec === 'soc' || sec === 'tax') {
      var a = lineAccount();
      a.sal = a.sal || { brut: 0, soc: 0, tax: 0 };
      a.sal[sec] = amount;
      if (sec === 'brut' && /13/.test(label)) a.sal.x13 = true;
      (this.salSet[m + '|' + a.name] = this.salSet[m + '|' + a.name] || {})[sec] = true;
    } else if (sec === 'net' || sec === 'inc' || sec === 'out') {
      var type = sec === 'out' ? 'out' : 'inc';
      var b = lineAccount();
      var cat = matchCategory(it.cat, type);
      if (!cat && it.cat && String(it.cat).trim()) {
        if (this.fromExport) cat = I.catKey(String(it.cat).trim());
        else this.warn(it.row, 'imp.unknownCat', { text: it.cat });
      }
      if (!cat) cat = catFor(guess(label, type === 'inc' ? 1 : -1), type);
      if (sec === 'net') { cat = 'Salaire'; if (!label) label = t('salary.net'); }
      var item = { label: label || (this.exact ? '' : I.cat(cat)), cat: cat, amount: amount };
      if (isYes(it.once)) item.once = true;
      var od = it.opdate ? parseDate(it.opdate) : null;
      if (od) item.d = od;
      b[type].push(item);
      if (sec === 'net') this.nets.push({ row: it.row, m: m, acc: b.name, item: item });
    } else if (sec === 'sav' || sec === 'debt') {
      var bal = parseAmount(it.balance);
      this.month(m)[sec].push({ name: label || (this.exact ? '' : t(sec + '.h')), pay: amount, bal: bal === null ? 0 : Math.abs(bal), cur: cur || this.base });
    } else if (sec === 'wish') {
      this.month(m).wish.push({ label: label || (this.exact ? '' : t('wish.h')), amount: amount });
    } else if (sec === 'plan') {
      var pc = matchCategory(it.cat || label, 'out') || (this.fromExport && it.cat ? I.catKey(String(it.cat).trim()) : '');
      if (!pc) { this.warn(it.row, 'imp.unknownCat', { text: it.cat || label }); return; }
      this.month(m).plan[pc] = amount;
    }
    this.count++;
  };
  Draft.prototype.isEmpty = function () { return !Object.keys(this.months).length; };
  /* Un salaire net donné en plus du salaire brut ferait compter le salaire deux fois :
     le net est retiré, et s'il n'y a ni cotisations ni impôt, la différence devient les cotisations. */
  Draft.prototype.finish = function () {
    var self = this;
    this.nets.forEach(function (n) {
      var set = self.salSet[n.m + '|' + n.acc];
      if (!set || !set.brut) return;
      var a = self.months[n.m].accounts.filter(function (x) { return x.name === n.acc; })[0];
      var i = a ? a.inc.indexOf(n.item) : -1;
      if (i === -1) return;
      a.inc.splice(i, 1);
      self.count--;
      var diff = round(a.sal.brut - n.item.amount);
      if (!set.soc && !set.tax && diff > 0) {
        a.sal.soc = diff; set.soc = true;
        self.warn(n.row, 'imp.netToSoc', { amount: A.fmt(n.item.amount, a.cur), account: a.name, diff: A.fmt(diff, a.cur) });
      } else {
        self.warn(n.row, 'imp.netDropped', { amount: A.fmt(n.item.amount, a.cur), account: a.name, calc: t('salary.net') + ' ' + A.fmt(a.sal.brut - a.sal.soc - a.sal.tax, a.cur) });
      }
    });
    this.nets = [];
    return this;
  };

  /* ---------- Tableau (Excel, CSV, tableau Markdown ou Word) ---------- */

  var COLS = {
    month: ['mois', 'month', 'periode', 'period', 'monat', 'date'],
    section: ['section', 'type', 'nature', 'rubrique', 'genre', 'kind', 'abschnitt', 'art'],
    account: ['compte', 'account', 'konto'],
    bank: ['banque', 'bank'],
    cur: ['devise', 'currency', 'monnaie', 'waehrung', 'wahrung'],
    label: ['libelle', 'label', 'description', 'nom', 'name', 'poste', 'intitule', 'designation', 'detail', 'details', 'texte', 'text', 'bezeichnung', 'beschreibung', 'buchungstext'],
    cat: ['categorie', 'category', 'kategorie', 'cat'],
    amount: ['montant', 'amount', 'valeur', 'value', 'somme', 'sum', 'betrag', 'prix', 'price', 'preis', 'versement', 'payment', 'einzahlung', 'mensualite', 'rate'],
    balance: ['solde', 'balance', 'reste du', 'reste', 'restant', 'left to pay', 'saldo', 'restschuld'],
    opdate: ['date operation', 'date de l\'operation', 'transaction date', 'buchungsdatum', 'date op'],
    once: ['ponctuelle', 'ponctuel', 'one-off', 'one off', 'einmalig']
  };
  function headerMap(row) {
    var map = {}, used = {};
    Object.keys(COLS).forEach(function (k) {
      for (var i = 0; i < row.length; i++) {
        if (used[i]) continue;
        var h = norm(row[i]).replace(/\s*\(.*\)$/, '');
        if (COLS[k].indexOf(h) !== -1) { map[k] = i; used[i] = 1; return; }
      }
    });
    return map;
  }

  /* Tableau avec une colonne « Section » (format des modèles et des exports). */
  function tableToDraft(rows, name, infos, fromExport) {
    var hi = -1, map = null;
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var m = headerMap(rows[r] || []);
      if (m.section !== undefined && m.amount !== undefined) { hi = r; map = m; break; }
    }
    if (hi === -1) return null;
    var body = rows.slice(hi + 1).filter(function (row) { return row.some(function (c) { return String(c).trim() !== ''; }); });
    var known = body.filter(function (row) { return sectionOf(row[map.section]); }).length;
    if (!body.length || known < Math.max(1, body.length / 2)) return null;
    var exact = Object.keys(HEAD).some(function (l) { return HEAD[l].slice(0, 9).every(function (x, k) { return norm(rows[hi][k]) === norm(x); }); });
    var draft = new Draft(name, fromExport, exact);
    draft.infos = infos || null;
    if (infos && infos.base) draft.base = infos.base;
    var get = function (row, k) { return map[k] === undefined ? '' : row[map[k]]; };
    rows.slice(hi + 1).forEach(function (row, i) {
      if (!row.some(function (c) { return String(c).trim() !== ''; })) return;
      var secText = get(row, 'section');
      draft.add({
        row: hi + i + 2, month: get(row, 'month'), section: sectionOf(secText), sectionText: secText,
        account: get(row, 'account'), bank: get(row, 'bank'), cur: get(row, 'cur'),
        label: get(row, 'label'), cat: get(row, 'cat'), amount: get(row, 'amount'), balance: get(row, 'balance'),
        opdate: get(row, 'opdate'), once: get(row, 'once')
      });
    });
    return draft;
  }

  /* Liste simple : « libellé ; montant » (CSV à 2 ou 3 colonnes, sans date). */
  function listToDraft(rows, name) {
    var lines = rows.map(function (r) {
      var cells = r.map(function (c) { return String(c).trim(); }).filter(Boolean);
      if (cells.length === 1) return cells[0];
      var amountAt = -1;
      for (var i = cells.length - 1; i >= 0; i--) if (parseAmount(cells[i]) !== null && /\d/.test(cells[i]) && !/[a-z]{4,}/i.test(cells[i])) { amountAt = i; break; }
      if (amountAt <= 0) return cells.join(' ');
      var label = cells.slice(0, amountAt).join(' ');
      var extra = cells.slice(amountAt + 1).join(' ');
      return label + ' : ' + cells[amountAt] + (extra ? ' (' + extra + ')' : '');
    });
    return textToDraft(lines, name);
  }

  /* ---------- Texte libre (Markdown, texte, Word, PDF d'un modèle) ----------
     Mois : 2026-10        Compte : Compte courant (UBS, CHF)
     ## Salaire            Salaire brut : 6000 / Cotisations : 800 / Impôt : 0
     ## Dépenses           Loyer : 1500 (Logement)
     ## Épargne            3e pilier A : 300 / 8800
     Une ligne seule comme « salaire = 3000 » est aussi comprise. */
  var LINE_RE = /^(.+?)\s*(?:[:=;\t|]|\s-\s|\.{2,})\s*([-−+]?\s*(?:[A-Za-z€$£]{1,4}\s*)?[\d'’\s  .,]*\d(?:[.,]\d{1,2})?)\s*(?:([A-Za-z€$£]{1,4})\b\.?)?\s*(?:\/\s*([-−]?[\d'’\s  .,]*\d(?:[.,]\d{1,2})?)\s*(?:[A-Za-z€$£]{1,4})?)?\s*(?:[(\[]([^)\]]*)[)\]])?\s*$/;
  var LOOSE_RE = /^(.*?[A-Za-zÀ-ÿ].*?)\s+([-−+]?(?:[A-Za-z€$£]{1,4}\s*)?\d[\d'’\s  .,]*?(?:[.,]\d{1,2})?)\s*([A-Za-z€$£]{1,4})?\s*(?:[(\[]([^)\]]*)[)\]])?\s*$/;

  var TOTAL_RE = /^(total|totaux|sous[- ]?total|subtotal|grand total|somme totale|solde|balance|reste a vivre|reste pour vivre|left over|net total)\b/;

  function cleanLine(l) {
    return String(l).replace(/(\d)[.,]-{1,2}(?=\s|$|\)|\/)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*+•>]|\d+[.)])\s+/, '').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim();
  }

  function parseTextLines(lines) {
    var out = [], section = null, month, account, bank, cur, n = 0;
    lines.forEach(function (raw) {
      n++;
      var heading = /^\s*#{1,6}\s+/.test(raw);
      var l = cleanLine(String(raw).replace(/^\s*#{1,6}\s+/, ''));
      if (!l || /^-{3,}$/.test(l) || /^<!--/.test(l)) return;
      // Titre de section : « ## Dépenses », « Dépenses : », « DÉPENSES »
      var bare = l.replace(/\s*:\s*$/, '');
      // Titre de mois : « ## Octobre 2026 », « Novembre 2026 : »
      if (!/[:=]\s*\S/.test(l) && parseMonth(bare.replace(/^(mois|month)\s+(de\s+)?/i, ''))) { month = bare.replace(/^(mois|month)\s+(de\s+)?/i, ''); section = null; return; }
      var sec = sectionOf(bare);
      if (sec && (heading || /:\s*$/.test(l) || !/\d/.test(l))) { section = sec === 'net' || sec === 'soc' || sec === 'tax' ? 'brut' : sec; if (sec === 'account') section = null; return; }
      if (heading) return;
      var kv = /^([^:=]+?)\s*[:=]\s*(.*)$/.exec(l);
      if (kv) {
        var key = norm(kv[1]);
        if (['mois', 'month', 'periode', 'period', 'monat'].indexOf(key) !== -1) { month = kv[2].trim(); return; }
        if (['banque', 'bank'].indexOf(key) !== -1) { bank = kv[2].trim(); return; }
        if (['devise', 'currency', 'monnaie'].indexOf(key) !== -1) { cur = kv[2].trim(); return; }
        if (WORD_TO_SECTION[key] === 'account' && !/\d{2,}[.,]?\d*\s*$/.test(kv[2])) {
          var am = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(kv[2].trim());
          account = am[1].trim();
          bank = ''; cur = '';
          if (am[2]) am[2].split(/[,;]/).forEach(function (p) { p = p.trim(); if (parseCurrency(p)) cur = p; else if (p) bank = p; });
          out.push({ row: n, month: month, section: 'account', account: account, bank: bank, cur: cur });
          return;
        }
      }
      var m = LINE_RE.exec(l) || null, label, amt, c2, bal, cat;
      if (m) { label = m[1]; amt = m[2]; c2 = m[3]; bal = m[4]; cat = m[5]; }
      else if ((m = LOOSE_RE.exec(l))) { label = m[1]; amt = m[2]; c2 = m[3]; cat = m[4]; }
      else { out.push({ row: n, section: null, label: l }); return; }
      // Une date n'est pas un montant (« Exporté le 11.10.2026 »).
      // Les lettres devant un montant doivent être une devise (« CHF 40 », « € 12 ») : « le 03.10 » n'en est pas une.
      var pre = /^[-−+]?\s*([A-Za-z€$£]{1,4})/.exec(amt.trim());
      if (pre && !parseCurrency(pre[1])) { out.push({ row: n, section: null, label: l }); return; }
      var core = amt.trim().replace(/^[-−+]?\s*[A-Za-z€$£]{1,4}\s*/, '').replace(/[\s.]+$/, '');
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(core) || /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(core)) { out.push({ row: n, section: null, label: l }); return; }
      label = label.trim().replace(/\s*[:=\-]$/, '');
      // Les totaux sont calculés par le site : les reprendre compterait tout deux fois.
      if (section !== 'sav' && section !== 'debt' && TOTAL_RE.test(norm(label))) { out.push({ row: n, total: true, label: label }); return; }
      var lineCur = parseCurrency(c2) || parseCurrency((/^[-−+]?\s*([A-Za-z€$£]{1,4})/.exec(amt.trim()) || [])[1]) || cur;
      var own = sectionOf(label);
      var s;
      if (own && own !== 'account' && (section === null || section === 'brut' || own === 'brut' || own === 'net' || own === 'soc' || own === 'tax')) s = own;
      else if (section === 'brut') s = 'inc';
      else if (section) s = section;
      else {
        var sign = /^\s*[-−]/.test(amt) ? -1 : 0;
        var g = guess(label, sign || -1);
        s = sign < 0 ? 'out' : g.type;
      }
      out.push({ row: n, month: month, section: s, account: account, bank: '', cur: lineCur, label: own && (s === own) && own !== 'inc' && own !== 'out' ? '' : label, cat: cat, amount: amt, balance: bal });
    });
    return out;
  }

  function textToDraft(lines, name) {
    var items = parseTextLines(lines);
    var useful = items.filter(function (i) { return i.section && i.section !== 'account'; });
    if (!useful.length) return null;
    var draft = new Draft(name, false);
    items.forEach(function (it) {
      if (it.total) { draft.warn(it.row, 'imp.total', { text: it.label.slice(0, 60) }); return; }
      if (!it.section) { if (/\d/.test(it.label)) draft.warn(it.row, 'imp.notUnderstood', { text: it.label.slice(0, 60) }); return; }
      draft.add(it);
    });
    return draft;
  }

  /* ---------- Rapport créé par le site (Markdown, Word ou PDF), modifié ou non ----------
     Les éléments sont lus dans l'ordre : { text } pour un titre ou un paragraphe,
     { cells } pour une ligne de tableau. Chaque tableau du rapport se reconnaît à ses en-têtes. */
  var REPORT_TABLES = {
    summary: ['rep.item', 'col.amount'], totals: ['rep.total', 'col.amount'], cats: ['col.cat', 'col.amount', 'chart.part'],
    lines: ['col.label', 'col.cat', 'col.amount'], sav: ['col.name', 'col.pay', 'col.bal'], debt: ['col.name', 'col.repay', 'col.left'], wish: ['col.item', 'col.price']
  };
  function inBoth(text, key) { var n = norm(text); return I.langs.some(function (l) { return n === norm(I.tIn(l, key)); }); }
  function tableKind(cells) {
    var c = cells.filter(function (x) { return String(x).trim() !== ''; });
    for (var k in REPORT_TABLES) {
      var keys = REPORT_TABLES[k];
      if (c.length !== keys.length) continue;
      if (I.langs.some(function (l) { return keys.every(function (key, i) { return norm(c[i]) === norm(I.tIn(l, key)); }); })) return k;
    }
    return null;
  }
  function salaryLabel(text, key) {
    var n = norm(text), C = window.BUDGET_COUNTRIES;
    return Object.keys(C).some(function (cc) { return norm(C[cc][key]) === n || ['en', 'de'].some(function (l) { return C[cc][l] && norm(C[cc][l][key]) === n; }); });
  }
  /* Devise d'un montant mis en forme (« 160,00 € », « CHF 1’800.00 », « 300.00 EUR »). */
  function curOf(s, fallback) {
    s = String(s || '');
    var m = /(?:^|[^A-Za-z])([A-Z]{3})(?:[^A-Za-z]|$)/.exec(s);
    if (m) return m[1];
    var strip = function (x) { return String(x).replace(/[\d\s.,'’  +\-−()]/g, ''); };
    var sym = strip(s);
    if (!sym) return fallback;
    var list = [fallback].concat(window.BUDGET_CURRENCIES || []);
    for (var i = 0; i < list.length; i++) if (list[i] && strip(A.fmt(0, list[i])) === sym) return list[i];
    return parseCurrency(sym) || fallback;
  }
  function isReport(els) {
    var head = false, body = false;
    els.forEach(function (e) {
      if (!e.cells) return;
      var k = tableKind(e.cells);
      if (k === 'summary' || k === 'totals') head = true;
      if (k === 'lines' || k === 'sav' || k === 'debt' || k === 'wish') body = true;
    });
    return head && body;
  }
  function reportToDraft(els, name) {
    if (!isReport(els)) return null;
    var draft = new Draft(name, true, true);
    var month = '', acc = '', block = null, table = null, step = 0, row = 0;
    var C = window.BUDGET_COUNTRIES;
    els.forEach(function (e) {
      row++;
      var cells = e.cells ? e.cells.map(function (c) { return String(c == null ? '' : c).trim(); }) : null;
      var kind = cells ? tableKind(cells) : null;
      if (kind) { table = kind; step = 0; return; }
      var text = e.text != null ? String(e.text).trim() : (cells && cells.filter(Boolean).length === 1 && !(table && cells.length > 1) ? cells.filter(Boolean)[0] : null);
      if (text != null) {
        if (!text) return;
        if (inBoth(text, 'income')) { block = 'inc'; table = null; return; }
        if (inBoth(text, 'expenses')) { block = 'out'; table = null; return; }
        if (['rep.summary', 'rep.cats', 'sav.h', 'debt.h', 'wish.h'].some(function (k) { return inBoth(text, k); })) { table = null; return; }
        var pm = parseMonth(text), mt;
        if (pm) { month = pm; acc = ''; block = null; table = null; return; }
        if ((mt = /^budget\s+(?:de\s+|d['’]\s*|for\s+|of\s+|f[üu]r\s+)?(.+)$/i.exec(text)) && parseMonth(mt[1])) { month = parseMonth(mt[1]); return; }
        if ((mt = /^(.+?),\s+(?:totaux en|totals in|summen in)\s+([A-Z]{3})\./.exec(text))) {
          draft.base = mt[2];
          var cc = Object.keys(C).filter(function (k) { return norm(C[k].name) === norm(mt[1]) || ['en', 'de'].some(function (l) { return C[k][l] && norm(C[k][l].name) === norm(mt[1]); }); })[0];
          draft.infos = draft.infos || {};
          draft.infos.base = mt[2];
          if (cc) draft.infos.country = cc;
          return;
        }
        if (/^(taux de change utilises|exchange rates used|verwendete wechselkurse)\s*:/.test(norm(text))) {
          var re = /1\s+([A-Z]{3})\s*=\s*([\d.]+)\s+([A-Z]{3})/g, r2;
          draft.infos = draft.infos || {};
          while ((r2 = re.exec(text))) { if (+r2[2] > 0) { draft.infos.rates = draft.infos.rates || {}; draft.infos.rates[r2[1]] = +r2[2]; } }
          return;
        }
        var parts = text.split(/\s+·\s+/);
        if (parts.length >= 2 && /^[A-Z]{3}$/.test(parts[parts.length - 1])) {
          acc = parts[0]; block = null; table = null;
          draft.add({ row: row, month: month, section: 'account', account: acc, bank: parts.length > 2 ? parts.slice(1, -1).join(' · ') : '', cur: parts[parts.length - 1] });
          return;
        }
        return;
      }
      if (!cells || !table || table === 'summary' || table === 'totals' || table === 'cats') return;
      var first = cells[0], last = cells[cells.length - 1];
      var label = first === '-' ? '' : first;
      if (table === 'lines') {
        var cat = cells.length >= 3 ? cells[1] : '';
        var sec = block || 'out';
        if (sec === 'inc' && !cat) {
          if (inBoth(first, 'salary.gross')) { sec = 'brut'; step = 1; }
          else if (inBoth(first, 'salary.net')) { step = 0; return; }
          else if (salaryLabel(first, 'soc') || step === 1) { sec = 'soc'; step = 2; }
          else if (salaryLabel(first, 'tax') || step === 2) { sec = 'tax'; step = 3; }
        }
        draft.add({ row: row, month: month, section: sec, account: acc, label: sec === 'brut' || sec === 'soc' || sec === 'tax' ? '' : label, cat: cat, amount: last });
      } else if (table === 'sav' || table === 'debt') {
        draft.add({ row: row, month: month, section: table, label: label, amount: cells[1], balance: cells[2], cur: curOf(cells[1], draft.base) });
      } else if (table === 'wish') {
        draft.add({ row: row, month: month, section: 'wish', label: label, amount: last });
      }
    });
    return draft.isEmpty() ? null : draft;
  }

  function thisMonth() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }

  function num(v) { if (typeof v === 'number') return v; var n = parseAmount(v); return n === null ? 0 : n; }

  function infoRows(lang) {
    var S = A.state;
    var rows = [L(lang).keyHead];
    rows.push(['country', S.country, A.countryName(S.country)]);
    rows.push(['base', S.base, L(lang).base]);
    Object.keys(S.rates || {}).forEach(function (c) { if (S.rates[c] > 0) rows.push(['rate:' + c, S.rates[c], '1 ' + c + ' = ' + S.rates[c] + ' ' + S.base]); });
    rows.push(['advance', S.opts && S.opts.advance === false ? 0 : 1, L(lang).advance]);
    if (S.opts && S.opts.threshold !== null && S.opts.threshold !== undefined) rows.push(['threshold', S.opts.threshold, L(lang).threshold]);
    rows.push(['exported', stamp(), 'Budget mensuel']);
    return rows;
  }
  function readInfos(rows) {
    var o = { rates: {} };
    (rows || []).forEach(function (r) {
      var k = String(r[0] || '').trim(), v = r[1];
      if (k === 'country' && window.BUDGET_COUNTRIES[String(v)]) o.country = String(v);
      else if (k === 'base' && /^[A-Z]{3}$/.test(String(v))) o.base = String(v);
      else if (/^rate:[A-Z]{3}$/.test(k) && num(v) > 0) o.rates[k.slice(5)] = num(v);
      else if (k === 'exported') o.exported = true;
      else if (k === 'advance') (o.opts = o.opts || {}).advance = num(v) !== 0;
      else if (k === 'threshold' && v !== '' && v !== null) (o.opts = o.opts || {}).threshold = typeof v === 'number' ? v : parseAmount(v);
    });
    return o;
  }

  /* ================= Rapport (PDF, Word, Markdown) ================= */

  function report(scope) {
    var S = A.state, money = function (n, c) { return A.fmt(n, c || S.base); };
    var months = scope === 'all' ? Object.keys(S.months).sort() : [S.cur];
    var pct = new Intl.NumberFormat(A.locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    var mn = A.monthName(S.cur);
    var title = I.lang !== 'fr' ? t('rep.title', { month: mn }) : 'Budget ' + (/^[aeiouyàâéèêîôû]/i.test(mn) ? 'd\'' : 'de ') + mn;
    return {
      title: scope === 'all' ? t('rep.titleAll') : title,
      subtitle: t('rep.subtitle', { country: A.countryName(S.country), cur: S.base, date: new Date().toLocaleDateString(A.locale()) }),
      rates: (function () {
        var used = {};
        months.forEach(function (m) { var d = S.months[m]; d.accounts.forEach(function (a) { used[a.cur] = 1; }); d.sav.concat(d.debt).forEach(function (x) { if (x.cur) used[x.cur] = 1; }); });
        var list = Object.keys(used).filter(function (c) { return c !== S.base && S.rates && S.rates[c] > 0; }).sort()
          .map(function (c) { return '1 ' + c + ' = ' + S.rates[c] + ' ' + S.base; });
        return list.length ? t('rep.rates', { list: list.join(', ') }) : '';
      })(),
      months: months.map(function (m) {
        var d = S.months[m], r = A.calc(d);
        var summary = [];
        if (r.brut) summary.push([t('sum.gross'), money(r.brut)]);
        if (r.held) summary.push([t('sum.held'), money(r.held)]);
        summary.push([t('sum.net'), money(r.rev)], [t('sum.out'), money(r.dep)], [t('sum.bal'), money(r.solde)], [t('sum.sav'), money(r.sav)], [t('sum.debt'), money(r.debt)]);
        var cats = Object.keys(r.byCat).filter(function (k) { return r.byCat[k] > 0; }).sort(function (a, b) { return r.byCat[b] - r.byCat[a]; })
          .map(function (k) { return [I.cat(k), money(r.byCat[k]), pct.format(r.byCat[k] / r.dep * 100) + ' %']; });
        return {
          name: A.monthName(m), summary: summary, cats: cats,
          accounts: d.accounts.map(function (a) {
            var net = a.sal ? (a.sal.brut || 0) - (a.sal.soc || 0) - (a.sal.tax || 0) : 0;
            var ti = net + a.inc.reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
            var to = a.out.reduce(function (s, x) { return s + (+x.amount || 0); }, 0);
            var lines = [];
            if (a.sal) lines.push([t('salary.gross'), '', money(a.sal.brut, a.cur)], [A.socLabel(), '', '- ' + money(a.sal.soc, a.cur)], [A.taxLabel(), '', '- ' + money(a.sal.tax, a.cur)], [t('salary.net'), '', money(net, a.cur)]);
            a.inc.forEach(function (x) { lines.push([x.label || '-', I.cat(x.cat), money(x.amount, a.cur)]); });
            var out = a.out.map(function (x) { return [x.label || '-', I.cat(x.cat), money(x.amount, a.cur)]; });
            return {
              title: [a.name, a.bank, a.cur].filter(Boolean).join(' · '), income: lines, expenses: out,
              totals: [[t('tot.in'), money(ti, a.cur)], [t('tot.out'), money(to, a.cur)], [t('tot.bal'), money(ti - to, a.cur)]]
            };
          }),
          sav: d.sav.map(function (x) { return [x.name || '-', money(x.pay, x.cur), money(x.bal, x.cur)]; }),
          debt: d.debt.map(function (x) { return [x.name || '-', money(x.pay, x.cur), money(x.bal, x.cur)]; }),
          wish: d.wish.map(function (x) { return [x.label || '-', money(x.amount)]; })
        };
      })
    };
  }

  /* ---------- Markdown ---------- */
  function md(rep) {
    var cell = function (s) { return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' '); };
    var table = function (head, rows, right) {
      if (!rows.length) return '';
      return '| ' + head.map(cell).join(' | ') + ' |\n|' + head.map(function (h, i) { return right.indexOf(i) !== -1 ? ' ---: ' : ' --- '; }).join('|') + '|\n' +
        rows.map(function (r) { return '| ' + r.map(cell).join(' | ') + ' |'; }).join('\n') + '\n\n';
    };
    var out = '# ' + rep.title + '\n\n' + rep.subtitle + '\n\n' + (rep.rates ? rep.rates + '\n\n' : '');
    rep.months.forEach(function (m) {
      if (rep.months.length > 1) out += '## ' + m.name + '\n\n';
      var h = rep.months.length > 1 ? '###' : '##';
      out += h + ' ' + t('rep.summary') + '\n\n' + table([t('rep.item'), t('col.amount')], m.summary, [1]);
      if (m.cats.length) out += h + ' ' + t('rep.cats') + '\n\n' + table([t('col.cat'), t('col.amount'), t('chart.part')], m.cats, [1, 2]);
      m.accounts.forEach(function (a) {
        out += h + ' ' + a.title + '\n\n';
        if (a.income.length) out += '**' + t('income') + '**\n\n' + table([t('col.label'), t('col.cat'), t('col.amount')], a.income, [2]);
        if (a.expenses.length) out += '**' + t('expenses') + '**\n\n' + table([t('col.label'), t('col.cat'), t('col.amount')], a.expenses, [2]);
        out += table([t('rep.total'), t('col.amount')], a.totals, [1]);
      });
      if (m.sav.length) out += h + ' ' + t('sav.h') + '\n\n' + table([t('col.name'), t('col.pay'), t('col.bal')], m.sav, [1, 2]);
      if (m.debt.length) out += h + ' ' + t('debt.h') + '\n\n' + table([t('col.name'), t('col.repay'), t('col.left')], m.debt, [1, 2]);
      if (m.wish.length) out += h + ' ' + t('wish.h') + '\n\n' + table([t('col.item'), t('col.price')], m.wish, [1]);
    });
    out += '---\n\n' + t('rep.footer') + '\n\n';
    out += '<!-- budget-mensuel-backup:' + backupB64() + ' sum:' + textSum(out) + ' -->\n';
    return out;
  }

  /* ---------- Word (.docx) ---------- */
  function docx(rep) {
    var run = function (text, o) {
      o = o || {};
      return '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' + (o.b ? '<w:b/>' : '') + (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
        '<w:sz w:val="' + (o.size || 20) + '"/></w:rPr><w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r>';
    };
    var para = function (text, o) {
      o = o || {};
      return '<w:p><w:pPr><w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after == null ? 120 : o.after) + '"/>' + (o.right ? '<w:jc w:val="right"/>' : '') + '</w:pPr>' + run(text, o) + '</w:p>';
    };
    var table = function (head, rows, right) {
      if (!rows.length) return '';
      var tc = function (txt, i, bold) { return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>' + para(txt, { b: bold, right: right.indexOf(i) !== -1, after: 0 }) + '</w:tc>'; };
      return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders><w:top w:val="single" w:sz="8" w:color="151515"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="C4C2BA"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
        '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + head.map(function (h, i) { return tc(h, i, true); }).join('') + '</w:tr>' +
        rows.map(function (r) { return '<w:tr>' + r.map(function (c, i) { return tc(c, i, false); }).join('') + '</w:tr>'; }).join('') +
        '</w:tbl>' + para('', { after: 120 });
    };
    var body = para(rep.title, { b: true, size: 36, after: 80 }) + para(rep.subtitle, { color: '55544F', after: rep.rates ? 60 : 240 }) + (rep.rates ? para(rep.rates, { color: '55544F', after: 240 }) : '');
    rep.months.forEach(function (m) {
      if (rep.months.length > 1) body += para(m.name, { b: true, size: 30, before: 240, after: 120 });
      var h = function (txt) { return para(txt, { b: true, size: 24, before: 200, after: 80 }); };
      body += h(t('rep.summary')) + table([t('rep.item'), t('col.amount')], m.summary, [1]);
      if (m.cats.length) body += h(t('rep.cats')) + table([t('col.cat'), t('col.amount'), t('chart.part')], m.cats, [1, 2]);
      m.accounts.forEach(function (a) {
        body += h(a.title);
        if (a.income.length) body += para(t('income'), { b: true, after: 60 }) + table([t('col.label'), t('col.cat'), t('col.amount')], a.income, [2]);
        if (a.expenses.length) body += para(t('expenses'), { b: true, after: 60 }) + table([t('col.label'), t('col.cat'), t('col.amount')], a.expenses, [2]);
        body += table([t('rep.total'), t('col.amount')], a.totals, [1]);
      });
      if (m.sav.length) body += h(t('sav.h')) + table([t('col.name'), t('col.pay'), t('col.bal')], m.sav, [1, 2]);
      if (m.debt.length) body += h(t('debt.h')) + table([t('col.name'), t('col.repay'), t('col.left')], m.debt, [1, 2]);
      if (m.wish.length) body += h(t('wish.h')) + table([t('col.item'), t('col.price')], m.wish, [1]);
    });
    body += para(t('rep.footer'), { color: '55544F', size: 16, before: 240 });
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    // Copie de la sauvegarde dans une partie « customXml » (conservée par Word), avec l'empreinte du texte.
    var sum = docxSum(new DOMParser().parseFromString(doc, 'application/xml'));
    var guid = '{' + (crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12)).toUpperCase() + '}';
    var RELS = 'http://schemas.openxmlformats.org/package/2006/relationships', OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/customXml/itemProps1.xml" ContentType="application/vnd.openxmlformats-officedocument.customXmlProperties+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + RELS + '"><Relationship Id="rId1" Type="' + OD + 'officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc },
      { name: 'word/_rels/document.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + RELS + '"><Relationship Id="rId1" Type="' + OD + 'customXml" Target="../customXml/item1.xml"/></Relationships>' },
      { name: 'customXml/item1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><backup xmlns="' + BACKUP_NS + '" sum="' + sum + '">' + backupB64() + '</backup>' },
      { name: 'customXml/itemProps1.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="no"?><ds:datastoreItem ds:itemID="' + guid + '" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs><ds:schemaRef ds:uri="' + BACKUP_NS + '"/></ds:schemaRefs></ds:datastoreItem>' },
      { name: 'customXml/_rels/item1.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + RELS + '"><Relationship Id="rId1" Type="' + OD + 'customXmlProps" Target="itemProps1.xml"/></Relationships>' }
    ]);
  }
  var BACKUP_NS = 'https://budget-mensuel.ch/sauvegarde';
  function docxBackup(files) {
    for (var name in files) {
      if (!/^customXml\/item\d+\.xml$/.test(name)) continue;
      var x = new DOMParser().parseFromString(new TextDecoder().decode(files[name]), 'application/xml').documentElement;
      if (x && x.namespaceURI === BACKUP_NS && x.localName === 'backup') return { b64: x.textContent, sum: x.getAttribute('sum') || '' };
    }
    return null;
  }

  /* ---------- PDF ---------- */
  var W = {"F1":[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,556,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,556,556,333,556,537,278,333,556,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500],"F2":[278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,556,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,556,556,333,611,556,278,333,556,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556]};
  var CP1252 = { 0x20AC: 128, 0x201A: 130, 0x0192: 131, 0x201E: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02C6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017D: 142, 0x2018: 145, 0x2019: 146, 0x201C: 147, 0x201D: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02DC: 152, 0x2122: 153, 0x0161: 154, 0x203A: 155, 0x0153: 156, 0x017E: 158, 0x0178: 159, 0x202F: 32, 0x2009: 32, 0x2192: 62, 0x2212: 45 };
  function winAnsi(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c === 0xA0) out.push(32);
      else if (c >= 32 && c < 127) out.push(c);
      else if (c >= 0xA1 && c <= 0xFF) out.push(c);
      else if (CP1252[c] !== undefined) out.push(CP1252[c]);
      else out.push(63);
    }
    return out;
  }
  function textWidth(str, font, size) {
    if (font === 'F3') return str.length * 600 * size / 1000;
    return winAnsi(str).reduce(function (s, b) { return s + (W[font][b - 32] || 556); }, 0) * size / 1000;
  }
  function pdfStr(str) {
    return '(' + winAnsi(str).map(function (b) {
      if (b === 40 || b === 41 || b === 92) return '\\' + String.fromCharCode(b);
      if (b > 126) return '\\' + b.toString(8);
      return String.fromCharCode(b);
    }).join('') + ')';
  }
  function fit(str, font, size, max) {
    if (textWidth(str, font, size) <= max) return str;
    while (str.length > 1 && textWidth(str + '…', font, size) > max) str = str.slice(0, -1);
    return str + '…';
  }

  function pdf(rep) {
    var PW = 595.28, PH = 841.89, M = 50, pages = [], ops = [], y = PH - M;
    function newPage() { if (ops.length) pages.push(ops.join('\n')); ops = []; y = PH - M; }
    function need(h) { if (y - h < M + 20) newPage(); }
    function text(x, s, font, size, gray, align, width) {
      var tx = x;
      if (align === 'right') tx = x + width - textWidth(s, font, size);
      ops.push('BT ' + (gray ? '0.33 g ' : '0.08 g ') + '/' + font + ' ' + size + ' Tf ' + tx.toFixed(2) + ' ' + y.toFixed(2) + ' Td ' + pdfStr(s) + ' Tj ET');
    }
    function rule(w, gray) { ops.push((gray ? '0.77 G ' : '0.08 G ') + w + ' w ' + M + ' ' + y.toFixed(2) + ' m ' + (PW - M) + ' ' + y.toFixed(2) + ' l S'); }
    // Un titre n'est jamais laissé seul en bas de page : il faut la place du titre, de l'en-tête et de deux lignes.
    function heading(s, size, before, keep) { need(before + size + 20 + (keep === false ? 0 : 3 * 18 + 14)); y -= before; text(M, s, 'F2', size); y -= 8; }
    function table(head, rows, right) {
      if (!rows.length) return;
      var full = PW - 2 * M, n = head.length;
      var widths = n === 2 ? [full * 0.62, full * 0.38] : n === 3 ? [full * 0.5, full * 0.28, full * 0.22] : head.map(function () { return full / n; });
      var row = function (cells, font, gray) {
        need(18);
        var x = M;
        cells.forEach(function (c, i) {
          var r = right.indexOf(i) !== -1, w = widths[i] - (r ? 0 : 8);
          text(x, fit(String(c), font, 9.5, w), font, 9.5, gray, r ? 'right' : 'left', widths[i]);
          x += widths[i];
        });
        y -= 5; rule(0.4, true); y -= 12;
      };
      need(40);
      y -= 2; rule(0.9); y -= 12;
      row(head, 'F2', true);
      rows.forEach(function (r) { row(r, 'F1'); });
      y -= 6;
    }
    text(M, rep.title, 'F2', 20); y -= 18;
    text(M, rep.subtitle, 'F1', 10, true); y -= 14;
    if (rep.rates) { text(M, fit(rep.rates, 'F1', 10, PW - 2 * M), 'F1', 10, true); y -= 14; }
    rep.months.forEach(function (m, idx) {
      if (rep.months.length > 1) { if (idx > 0) newPage(); heading(m.name, 16, 16); }
      heading(t('rep.summary'), 12, 14); table([t('rep.item'), t('col.amount')], m.summary, [1]);
      if (m.cats.length) { heading(t('rep.cats'), 12, 10); table([t('col.cat'), t('col.amount'), t('chart.part')], m.cats, [1, 2]); }
      m.accounts.forEach(function (a) {
        heading(a.title, 12, 10);
        if (a.income.length) { heading(t('income'), 10, 4); table([t('col.label'), t('col.cat'), t('col.amount')], a.income, [2]); }
        if (a.expenses.length) { heading(t('expenses'), 10, 4); table([t('col.label'), t('col.cat'), t('col.amount')], a.expenses, [2]); }
        table([t('rep.total'), t('col.amount')], a.totals, [1]);
      });
      if (m.sav.length) { heading(t('sav.h'), 12, 10); table([t('col.name'), t('col.pay'), t('col.bal')], m.sav, [1, 2]); }
      if (m.debt.length) { heading(t('debt.h'), 12, 10); table([t('col.name'), t('col.repay'), t('col.left')], m.debt, [1, 2]); }
      if (m.wish.length) { heading(t('wish.h'), 12, 10); table([t('col.item'), t('col.price')], m.wish, [1]); }
    });
    need(30); y -= 10; text(M, t('rep.footer'), 'F1', 8, true);
    pages.push(ops.join('\n'));

    // Numéros de page
    pages = pages.map(function (c, i) { return c + '\nBT 0.33 g /F1 8 Tf ' + (PW - M - 40) + ' 30 Td ' + pdfStr((i + 1) + ' / ' + pages.length) + ' Tj ET'; });

    var objs = [], n = 0;
    var add = function (s) { objs.push(s); return ++n; };
    var catalog = add(''), pagesObj = add('');
    var f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    var f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    var f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
    var kids = pages.map(function (c) {
      var content = add('<< /Length ' + c.length + ' >>\nstream\n' + c + '\nendstream');
      return add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R >> >> /Contents ' + content + ' 0 R >>');
    });
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
    var info = add('<< /Title ' + pdfStr(rep.title) + ' /Producer (Budget mensuel) /CreationDate (D:' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + ') >>');
    var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
    objs.forEach(function (o, i) { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    // Sauvegarde intégrée (commentaire ignoré par les lecteurs PDF), pour pouvoir réimporter ce fichier.
    var bk = backupB64();
    out += '%BM-BACKUP-BEGIN\n' + bk.replace(/.{1,76}/g, '%$&\n') + '%BM-BACKUP-END\n';
    var xref = out.length;
    out += 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n' + offsets.map(function (o) { return String(o).padStart(10, '0') + ' 00000 n \n'; }).join('') +
      'trailer\n<< /Size ' + (n + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    var bytes = new Uint8Array(out.length);
    for (var i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
    return new Blob([bytes], { type: 'application/pdf' });
  }

  /* ================= Export ================= */

  function exportAs(format, scope) {
    var S = A.state;
    if (!S) return;
    var lang = I.lang, name = 'budget-mensuel-' + (scope === 'all' || ['json', 'xlsx', 'csv'].indexOf(format) !== -1 ? stamp() : S.cur);
    if (format === 'json') download(name + '.json', JSON.stringify(S, null, 2), 'application/json');
    else if (format === 'csv') download(name + '.csv', csv(tableRows(lang)), 'text/csv;charset=utf-8');
    else if (format === 'xlsx') {
      var keys = Object.keys(S.months).sort();
      var hist = [[t('hist.month'), t('sum.net'), t('sum.out'), t('sum.bal'), t('sum.sav'), t('sum.debt')]].concat(keys.map(function (k) {
        var r = A.calc(S.months[k]);
        return [k, round(r.rev), round(r.dep), round(r.solde), round(r.sav), round(r.debt)];
      }));
      download(name + '.xlsx', xlsx([
        { name: L(lang).lines, rows: tableRows(lang), header: true, widths: [10, 16, 22, 18, 9, 34, 26, 14, 14, 14, 11] },
        { name: L(lang).monthly, rows: hist, header: true, widths: [12, 16, 16, 16, 16, 16] },
        { name: 'Infos', rows: infoRows(lang), header: true, widths: [14, 14, 40] }
      ]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else if (format === 'md') download(name + '.md', md(report(scope)), 'text/markdown;charset=utf-8');
    else if (format === 'docx') download(name + '.docx', docx(report(scope)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    else if (format === 'pdf') download(name + '.pdf', pdf(report(scope)), 'application/pdf');
    A.log('export', { format: format.toUpperCase() });
    A.save();
  }
  function round(n) { return Math.round(n * 100) / 100; }

  /* ================= Import ================= */

  function msg(text) { var el = $('setup').hidden ? $('data-msg') : $('setup-detect'); el.textContent = text; }

  /* Sauvegarde complète (JSON, ou copie intégrée dans un PDF / Markdown exporté). */
  function restore(data, kind) {
    if (data && data.v !== 2 && data.months) data = A.migrate(data);
    if (!A.valid(data)) { msg(t('import.invalid')); return; }
    if (A.state && !confirm(t('confirm.import'))) return;
    A.replace(data, kind);
    msg(t('import.restored'));
  }

  function rowsHaveDates(rows) {
    if (!rows || rows.length < 2) return false;
    var map = guessMap(rows);
    if (map.date < 0) return false;
    var body = rows.slice(map.header ? 1 : 0);
    var dated = body.filter(function (r) { return parseDate(r[map.date]) !== null; }).length;
    return dated >= Math.max(1, body.length * 0.5);
  }

  /* Tableau quelconque : modèle (colonne Section), relevé (dates) ou liste simple. */
  function fromRows(rows, name, infos, fromExport) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) { msg(t('import.nothing')); return; }
    var draft = tableToDraft(rows, name, infos, fromExport);
    if (draft) return showDraft(draft);
    if (rowsHaveDates(rows)) return statementFromRows(rows, name);
    draft = listToDraft(rows, name);
    if (draft) return showDraft(draft);
    msg(t('import.nothing'));
  }

  /* Texte (Markdown, texte, Word, PDF) : modèle à remplir, tableau, relevé ou lignes « libellé : montant ». */
  function fromText(lines, name, tables, note, items) {
    var rep = reportToDraft(items || mdItems(lines), name);
    if (rep) return showDraft(rep, note);
    var all = (tables || []).concat([markdownRows(lines)]);
    for (var i = 0; i < all.length; i++) {
      if (all[i].length > 1) { var d = tableToDraft(all[i], name, null, false); if (d) return showDraft(d, note); }
    }
    var draft = textToDraft(lines, name);
    var dated = lines.filter(function (l) { return /^\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s+\S/.test(l); }).length;
    if (dated >= 2 && (!draft || dated > draft.count)) return statementFromLines(lines, name);
    for (i = 0; i < all.length; i++) {
      if (all[i].length > 1 && rowsHaveDates(all[i])) return statementFromRows(all[i], name);
    }
    if (draft) return showDraft(draft, note);
    msg(t('import.nothing'));
  }

  function importFile(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { msg(t('import.tooBig')); return; }
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    msg(t('import.reading'));
    hidePanels();
    file.arrayBuffer().then(function (buf) {
      var head = new TextDecoder('latin1').decode(new Uint8Array(buf).subarray(0, 5));
      if (head === '%PDF-' || ext === 'pdf') {
        var raw = new TextDecoder('latin1').decode(new Uint8Array(buf));
        var mk = /%BM-BACKUP-BEGIN\n([\s\S]*?)%BM-BACKUP-END/.exec(raw);
        // Un PDF modifié après l'export reçoit une mise à jour ajoutée à la fin (un 2e « %%EOF ») : la copie n'est alors plus à jour.
        var edited = mk && (raw.match(/%%EOF/g) || []).length > 1;
        if (mk && !edited) return restore(parseBackupB64(mk[1].replace(/%/g, '')), 'PDF');
        return pdfLines(buf).then(function (lines) {
          if (!lines.length) { msg(t('import.pdfNothing')); return; }
          fromText(lines, file.name, [], edited ? 'imp.edited' : null, lines.cells.map(function (c) { return { cells: c }; }));
        });
      }
      if (head.slice(0, 2) === 'PK') {
        return unzip(buf).then(function (files) {
          if (files['word/document.xml']) {
            var doc = readDocx(files['word/document.xml']);
            var bk = docxBackup(files);
            if (bk && bk.sum === doc.sum) { var saved = parseBackupB64(bk.b64); if (saved) return restore(saved, 'Word'); }
            return fromText(doc.lines, file.name, doc.tables, bk ? 'imp.edited' : null, doc.items);
          }
          if (files['xl/workbook.xml']) {
            return readXlsx(buf).then(function (sheets) {
              var info = sheets.filter(function (s) { return s.name === 'Infos'; })[0];
              var infos = info ? readInfos(info.rows.slice(1)) : null;
              var fromExport = !!(infos && infos.exported);
              var ordered = sheets.filter(function (s) { return SHEETS_SKIP.indexOf(s.name) === -1; });
              for (var i = 0; i < ordered.length; i++) {
                var d = tableToDraft(ordered[i].rows, file.name, infos, fromExport);
                if (d) return showDraft(d);
              }
              var best = ordered.filter(function (s) { return s.rows.length > 1; })[0];
              fromRows(best ? best.rows : [], file.name);
            });
          }
          msg(t('import.unsupported'));
        });
      }
      var text = decodeText(buf);
      if (ext === 'json' || /^\s*\{/.test(text)) {
        var data; try { data = JSON.parse(text); } catch (e) { data = null; }
        if (data) return restore(data, 'JSON');
        if (ext === 'json') { msg(t('import.invalid')); return; }
      }
      var bk = /<!--\s*budget-mensuel-backup:([A-Za-z0-9+/=\s]+?)(?:\s*sum:([0-9a-f]{8}))?\s*-->/.exec(text), note = null;
      if (bk) {
        if (!bk[2] || bk[2] === textSum(text.slice(0, bk.index))) return restore(parseBackupB64(bk[1]), 'Markdown');
        note = 'imp.edited';
        text = text.slice(0, bk.index) + text.slice(bk.index + bk[0].length);
      }
      if (/[\u0000-\u0008\u000E-\u001A]/.test(text.slice(0, 2000))) { msg(t('import.unsupported')); return; }
      var lines = text.split(/\r?\n/);
      if (note || ext === 'md' || ext === 'markdown' || ext === 'txt' && !/[;\t]/.test(text)) return fromText(lines, file.name, [], note);
      var rows = parseCsv(text);
      var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([0]));
      if (cols <= 1) return fromText(lines, file.name, []);
      fromRows(rows, file.name);
    }).catch(function (e) {
      msg(e && e.message === 'inflate' ? t('import.oldBrowser') : t('import.failed'));
    });
  }

  function mdCells(l) {
    return l.trim().replace(/\\\|/g, '\u0000').replace(/^\||\|$/g, '').split('|').map(function (c) { return c.replace(/\u0000/g, '|').trim(); });
  }
  function isMdRow(l) { return /^\s*\|.*\|\s*$/.test(l); }
  function isMdRule(l) { return /^\s*\|[\s:|-]+\|\s*$/.test(l); }
  function markdownRows(lines) {
    return lines.filter(function (l) { return isMdRow(l) && !isMdRule(l); }).map(mdCells);
  }
  /* Markdown ou texte, dans l'ordre : titres et paragraphes, lignes de tableau. */
  function mdItems(lines) {
    var out = [];
    lines.forEach(function (l) {
      if (isMdRow(l)) { if (!isMdRule(l)) out.push({ cells: mdCells(l) }); return; }
      var x = cleanLine(String(l).replace(/^\s*#{1,6}\s+/, ''));
      if (x && !/^<!--/.test(x) && !/^-{3,}$/.test(x)) out.push({ text: x });
    });
    return out;
  }

  /* Word : texte des paragraphes et contenu des tableaux. */
  function readDocx(u8) {
    var xml = new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml');
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    var text = function (node) {
      var s = '';
      var walk = function (n) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          if (c.localName === 't') s += c.textContent;
          else if (c.localName === 'tab') s += '\t';
          else if (c.localName === 'br' || c.localName === 'cr') s += '\n';
          else walk(c);
        }
      };
      walk(node);
      return s;
    };
    var lines = [], tables = [], items = [];
    var body = xml.getElementsByTagNameNS(W, 'body')[0];
    if (!body) return { lines: lines, tables: tables, items: items, sum: '' };
    for (var n = body.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 1) continue;
      if (n.localName === 'p') {
        var style = n.getElementsByTagNameNS(W, 'pStyle')[0];
        var isHead = style && /heading|titre|title/i.test(style.getAttributeNS(W, 'val') || style.getAttribute('w:val') || '');
        text(n).split('\n').forEach(function (l) { lines.push((isHead ? '## ' : '') + l); items.push({ text: l }); });
      } else if (n.localName === 'tbl') {
        var rows = [];
        Array.prototype.forEach.call(n.getElementsByTagNameNS(W, 'tr'), function (tr) {
          rows.push(Array.prototype.map.call(tr.getElementsByTagNameNS(W, 'tc'), function (tc) { return text(tc).trim(); }));
        });
        tables.push(rows);
        rows.forEach(function (r) { lines.push(r.join(' : ')); items.push({ cells: r }); });
      }
    }
    return { lines: lines, tables: tables, items: items, sum: docxSum(xml) };
  }

  /* ---------- Aperçu d'un import structuré ---------- */
  var draftNow = null;
  function hidePanels() { draftNow = null; current = null; $('structured').hidden = true; $('statement').hidden = true; }

  function showDraft(draft, note) {
    draft.finish();
    if (note) draft.warnings.unshift(t(note));
    if (draft.isEmpty()) { msg(t('import.nothing')); return; }
    draftNow = draft;
    msg('');
    if (location.hash !== '#reglages') location.hash = '#reglages';
    var S = A.state;
    var months = Object.keys(draft.months).sort();
    var accNames = {}, nLines = 0;
    var money = function (n, c) { return A.fmt(n, c || draft.base); };
    var html = '';
    months.forEach(function (m) {
      var d = draft.months[m], rows = [];
      d.accounts.forEach(function (a) {
        accNames[norm(a.name)] = 1;
        rows.push([t('imp.sec.account'), a.name, [a.bank, a.cur].filter(Boolean).join(', '), '', '']);
        if (a.sal) {
          var set = draft.salSet[m + '|' + a.name] || {};
          ['brut', 'soc', 'tax'].forEach(function (k) { if (set[k]) { rows.push([t('imp.sec.' + k), a.name, '', '', money(a.sal[k], a.cur)]); nLines++; } });
        }
        a.inc.forEach(function (x) { rows.push([t('imp.sec.inc'), a.name, x.label, I.cat(x.cat), money(x.amount, a.cur)]); nLines++; });
        a.out.forEach(function (x) { rows.push([t('imp.sec.out'), a.name, x.label, I.cat(x.cat), money(x.amount, a.cur)]); nLines++; });
      });
      d.sav.forEach(function (x) { rows.push([t('imp.sec.sav'), '', x.name, '', money(x.pay, x.cur) + ' · ' + money(x.bal, x.cur)]); nLines++; });
      d.debt.forEach(function (x) { rows.push([t('imp.sec.debt'), '', x.name, '', money(x.pay, x.cur) + ' · ' + money(x.bal, x.cur)]); nLines++; });
      d.wish.forEach(function (x) { rows.push([t('imp.sec.wish'), '', x.label, '', money(x.amount)]); nLines++; });
      Object.keys(d.plan || {}).forEach(function (c) { rows.push([t('imp.sec.plan'), '', '', I.cat(c), money(d.plan[c])]); nLines++; });
      html += '<h4>' + esc(A.monthName(m)) + (S && S.months[m] ? ' <span class="hint">' + esc(t('imp.monthExists')) + '</span>' : '') + '</h4>' +
        '<div class="history-wrap"><table class="history-table sd-table"><thead><tr><th scope="col">' + t('imp.col.section') + '</th><th scope="col">' + t('acc.name') + '</th><th scope="col">' + t('col.label') + '</th><th scope="col">' + t('col.cat') + '</th><th scope="col">' + t('col.amount') + '</th></tr></thead><tbody>' +
        rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i === 2 ? ' class="st-label"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table></div>';
    });
    $('sd-title').textContent = t('imp.title', { name: draft.name });
    $('sd-summary').textContent = t('imp.summary', { months: months.length, accounts: Object.keys(accNames).length, lines: nLines });
    $('sd-content').innerHTML = html;
    var w = $('sd-warnings');
    w.innerHTML = draft.warnings.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    $('sd-warnings-wrap').hidden = !draft.warnings.length;
    $('sd-merge').hidden = !S;
    $('sd-hint').hidden = !S;
    $('sd-replace').textContent = S ? t('imp.replace') : t('imp.create');
    $('sd-merge').className = draft.fromExport ? '' : 'primary';
    $('sd-replace').className = !S || draft.fromExport ? 'primary' : 'danger';
    $('structured').hidden = false;
    $('structured').scrollIntoView();
  }

  function applyDraft(mode) {
    var draft = draftNow, S = A.state;
    if (!draft) return;
    var copy = function (o) { return JSON.parse(JSON.stringify(o)); };
    if (mode === 'replace' || !S) {
      if (S && !confirm(t('imp.confirmReplace'))) return;
      var infos = draft.infos || {};
      var cc = infos.country || (S ? S.country : ($('setup-country') && $('setup-country').value) || 'XX');
      var data = {
        v: 2, country: window.BUDGET_COUNTRIES[cc] ? cc : 'XX', base: infos.base || draft.base, rates: Object.assign(S && (!infos.base || infos.base === S.base) ? copy(S.rates) : {}, infos.rates || {}),
        rateSrc: {}, cur: '', months: copy(draft.months), log: S ? S.log : [],
        opts: Object.assign(S ? copy(S.opts) : {}, infos.opts || {}), learn: S ? copy(S.learn) : {}
      };
      Object.keys(data.rates).forEach(function (k) { data.rateSrc[k] = 'manuel'; });
      var keys = Object.keys(data.months).sort();
      data.cur = S && keys.indexOf(S.cur) !== -1 ? S.cur : keys[keys.length - 1];
      hidePanels();
      A.replace(data, draft.name.split('.').pop().toUpperCase());
      msg(t('import.restored'));
      return;
    }
    // Ajout : les lignes du fichier s'ajoutent aux mois existants, sans doublon.
    A.beginChange();
    var added = 0, skipped = 0;
    Object.keys(draft.months).sort().forEach(function (m) {
      var src = draft.months[m];
      if (!S.months[m]) { S.months[m] = copy(src); added++; return; }
      var dst = S.months[m];
      src.accounts.forEach(function (a) {
        var b = dst.accounts.filter(function (x) { return norm(x.name) === norm(a.name); })[0];
        if (!b) { dst.accounts.push(copy(a)); return; }
        if (a.bank) b.bank = a.bank;
        var set = draft.salSet[m + '|' + a.name];
        if (set) { b.sal = b.sal || { brut: 0, soc: 0, tax: 0 }; Object.keys(set).forEach(function (k) { b.sal[k] = a.sal[k]; }); }
        ['inc', 'out'].forEach(function (k) {
          a[k].forEach(function (x) {
            var dup = b[k].some(function (y) { return norm(y.label) === norm(x.label) && +y.amount === +x.amount && y.cat === x.cat; });
            if (dup) skipped++; else b[k].push(copy(x));
          });
        });
      });
      ['sav', 'debt'].forEach(function (k) {
        src[k].forEach(function (x) {
          var y = dst[k].filter(function (z) { return norm(z.name) === norm(x.name); })[0];
          if (y) { y.pay = x.pay; y.bal = x.bal; y.cur = x.cur; } else dst[k].push(copy(x));
        });
      });
      src.wish.forEach(function (x) {
        var y = dst.wish.filter(function (z) { return norm(z.label) === norm(x.label); })[0];
        if (y) y.amount = x.amount; else dst.wish.push(copy(x));
      });
      dst.plan = dst.plan || {};
      Object.keys(src.plan || {}).forEach(function (c) { dst.plan[c] = src.plan[c]; });
      added++;
    });
    var months = Object.keys(draft.months).sort();
    S.cur = months[months.length - 1];
    A.log('statement', { n: draft.count, name: draft.name });
    hidePanels();
    A.save();
    msg(t('imp.merged', { months: months.map(A.monthName).join(', ') }) + (skipped ? ' ' + t('imp.skipped', { n: skipped }) : ''));
  }

  /* ---------- Modèles à remplir ---------- */
  function template(kind) {
    var lang = I.lang, S = A.state;
    var m = S ? S.cur : thisMonth();
    var cur = S ? S.base : ($('setup-cur') && $('setup-cur').value) || 'EUR';
    var X = langOf(SECT, lang), H = langOf(HEAD, lang), T = L(lang), ex = T.ex;
    var acc = T.acc;
    var rows = [H,
      [m, X.account, acc, T.bank, cur, '', '', null, null, '', ''],
      [m, X.brut, acc, '', '', '', '', 5000, null, '', ''],
      [m, X.soc, acc, '', '', '', '', 650, null, '', ''],
      [m, X.tax, acc, '', '', '', '', 0, null, '', ''],
      [m, X.inc, acc, '', '', ex[0], I.cat('Allocations'), 300, null, '', ''],
      [m, X.out, acc, '', '', ex[1], I.cat('Logement'), 1500, null, '', ''],
      [m, X.out, acc, '', '', ex[2], I.cat('Courses et ménage'), 600, null, '', ''],
      [m, X.out, acc, '', '', ex[3], I.cat('Santé et assurances'), 350, null, '', ''],
      [m, X.sav, '', '', cur, ex[4], '', 200, 5000, '', ''],
      [m, X.debt, '', '', cur, ex[5], '', 300, 9000, '', ''],
      [m, X.wish, '', '', '', ex[6], '', 900, null, '', ''],
      [m, X.plan, '', '', '', '', I.cat('Courses et ménage'), 650, null, '', '']
    ];
    var base = T.file;
    if (kind === 'csv') return download(base + '.csv', csv(rows), 'text/csv;charset=utf-8');
    if (kind === 'xlsx') {
      var sections = Object.keys(X).map(function (k) { return X[k]; });
      var cats = A.outCats().concat(A.IN_CATS).filter(function (c, i, a) { return a.indexOf(c) === i; }).map(I.cat);
      var lists = [T.listHead];
      var curs = window.BUDGET_CURRENCIES;
      for (var i = 0; i < Math.max(sections.length, cats.length, curs.length); i++) lists.push([sections[i] || null, cats[i] || null, curs[i] || null]);
      var listName = T.lists;
      var help = ({ fr: TEMPLATE_HELP_FR, de: TEMPLATE_HELP_DE }[lang] || TEMPLATE_HELP_EN).map(function (l) { return [l]; });
      return download(base + '.xlsx', xlsx([
        { name: 'Budget', rows: rows, header: true, widths: [10, 16, 20, 16, 9, 30, 28, 12, 12, 14, 11], textCols: [0],
          validations: [
            { sqref: 'B2:B1000', formula: listName + '!$A$2:$A$' + (sections.length + 1) },
            { sqref: 'G2:G1000', formula: listName + '!$B$2:$B$' + (cats.length + 1) },
            { sqref: 'E2:E1000', formula: listName + '!$C$2:$C$' + (curs.length + 1) }
          ] },
        { name: T.help, rows: help, widths: [120] },
        { name: listName, rows: lists, header: true, widths: [18, 34, 10] },
        { name: 'Infos', rows: [T.keyHead, ['base', cur, T.base]], header: true, widths: [14, 14, 40] }
      ]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }
    var text = ({ fr: TEMPLATE_TEXT_FR, de: TEMPLATE_TEXT_DE }[lang] || TEMPLATE_TEXT_EN).replace(/\{month\}/g, m).replace(/\{cur\}/g, cur);
    if (kind === 'md') return download(base + '.md', text, 'text/markdown;charset=utf-8');
    if (kind === 'docx') return download(base + '.docx', textDocx(text), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  var TEMPLATE_HELP_FR = [
    'Comment remplir ce modèle',
    '',
    'Une ligne par élément, dans l\'onglet Budget. Remplacez les exemples par vos chiffres, ajoutez autant de lignes que nécessaire.',
    'Mois : au format 2026-10 (ou 10.2026, ou « octobre 2026 »). Une ligne vide prend le mois affiché dans le site.',
    'Section : choisissez dans la liste. Compte, Salaire brut, Cotisations, Impôt retenu, Revenu, Dépense, Épargne, Dette, Envie ou Budget prévu.',
    'Compte : le nom du compte bancaire. Une ligne « Compte » permet d\'indiquer la banque et la devise.',
    'Libellé : par exemple « Loyer ». Catégorie : choisissez dans la liste ; si elle est vide, le site la devine d\'après le libellé.',
    'Montant : le montant du mois. Pour Épargne et Dette : le versement mensuel dans Montant, et le solde ou le reste dû dans Solde.',
    'Date opération et Ponctuelle sont facultatives : « oui » dans Ponctuelle signifie que la ligne ne sera pas reprise le mois suivant.',
    'Puis dans le site : Réglages, Vos données, Importer un fichier. Un aperçu montre où chaque ligne va avant de valider.'
  ];
  var TEMPLATE_HELP_EN = [
    'How to fill in this template',
    '',
    'One line per item, in the Budget sheet. Replace the examples with your figures and add as many lines as you need.',
    'Month: as 2026-10 (or 10.2026, or "October 2026"). An empty cell uses the month shown on the site.',
    'Section: pick from the list. Account, Gross salary, Contributions, Tax withheld, Income, Expense, Savings, Debt, Wish or Planned budget.',
    'Account: the name of the bank account. An "Account" line lets you set the bank and currency.',
    'Label: for example "Rent". Category: pick from the list; if empty, the site guesses it from the label.',
    'Amount: the monthly amount. For Savings and Debt: the monthly payment in Amount, and the balance or amount left in Balance.',
    'Transaction date and One-off are optional: "yes" under One-off means the line is not copied to the next month.',
    'Then on the site: Settings, Your data, Import a file. A preview shows where each line goes before you confirm.'
  ];
  var TEMPLATE_HELP_DE = [
    'So füllen Sie diese Vorlage aus',
    '',
    'Eine Zeile pro Posten, im Blatt Budget. Ersetzen Sie die Beispiele durch Ihre Zahlen und fügen Sie so viele Zeilen hinzu wie nötig.',
    'Monat: im Format 2026-10 (oder 10.2026 oder «Oktober 2026»). Eine leere Zelle verwendet den auf der Seite angezeigten Monat.',
    'Abschnitt: aus der Liste wählen. Konto, Bruttolohn, Abzüge, Quellensteuer, Einnahme, Ausgabe, Ersparnis, Schuld, Wunsch oder Geplantes Budget.',
    'Konto: der Name des Bankkontos. Eine Zeile «Konto» legt Bank und Währung fest.',
    'Bezeichnung: zum Beispiel «Miete». Kategorie: aus der Liste wählen; wenn leer, errät die Seite sie anhand der Bezeichnung.',
    'Betrag: der Monatsbetrag. Für Ersparnis und Schuld: die monatliche Einzahlung oder Rate unter Betrag, den Saldo oder die Restschuld unter Saldo.',
    'Buchungsdatum und Einmalig sind freiwillig: «ja» unter Einmalig bedeutet, dass die Zeile nicht in den nächsten Monat übernommen wird.',
    'Danach auf der Seite: Einstellungen, Ihre Daten, Datei importieren. Eine Vorschau zeigt vor dem Bestätigen, wohin jede Zeile kommt.'
  ];
  var TEMPLATE_TEXT_DE = [
    '# Mein Budget',
    '',
    'Ersetzen Sie die Beispiele durch Ihre Zahlen und importieren Sie diese Datei in Budget mensuel (Einstellungen, Ihre Daten, Datei importieren).',
    'Eine Zeile pro Posten: «Bezeichnung: Betrag». Die Kategorie ist freiwillig, in Klammern.',
    '',
    'Monat: {month}',
    'Konto: Privatkonto (Meine Bank, {cur})',
    '',
    '## Lohn',
    'Bruttolohn: 5000',
    'Abzüge: 650',
    'Steuer: 0',
    '',
    '## Einnahmen',
    'Kinderzulage: 300 (Zulagen)',
    '',
    '## Ausgaben',
    'Miete: 1500 (Wohnen)',
    'Einkäufe: 600 (Lebensmittel und Haushalt)',
    'Krankenkasse: 350 (Gesundheit und Versicherungen)',
    'Telefon: 50',
    '',
    '## Ersparnisse',
    'Monatliche Einzahlung / aktueller Saldo',
    'Sparkonto: 200 / 5000',
    '',
    '## Schulden',
    'Monatliche Rate / Restschuld',
    'Autokredit: 300 / 9000',
    '',
    '## Wünsche',
    'Velo: 900',
    ''
  ].join('\n');
  var TEMPLATE_TEXT_FR = [
    '# Mon budget',
    '',
    'Remplacez les exemples par vos chiffres, puis importez ce fichier dans Budget mensuel (Réglages, Vos données, Importer un fichier).',
    'Une ligne par élément : « libellé : montant ». La catégorie est facultative, entre parenthèses.',
    '',
    'Mois : {month}',
    'Compte : Compte courant (Ma banque, {cur})',
    '',
    '## Salaire',
    'Salaire brut : 5000',
    'Cotisations : 650',
    'Impôt : 0',
    '',
    '## Revenus',
    'Allocations familiales : 300 (Allocations)',
    '',
    '## Dépenses',
    'Loyer : 1500 (Logement)',
    'Courses : 600 (Courses et ménage)',
    'Assurance maladie : 350 (Santé et assurances)',
    'Téléphone : 50',
    '',
    '## Épargne',
    'Versement mensuel / solde actuel',
    'Compte épargne : 200 / 5000',
    '',
    '## Dettes',
    'Mensualité / reste dû',
    'Crédit voiture : 300 / 9000',
    '',
    '## Envies',
    'Vélo : 900',
    ''
  ].join('\n');
  var TEMPLATE_TEXT_EN = [
    '# My budget',
    '',
    'Replace the examples with your figures, then import this file into Budget mensuel (Settings, Your data, Import a file).',
    'One line per item: "label: amount". The category is optional, in brackets.',
    '',
    'Month: {month}',
    'Account: Current account (My bank, {cur})',
    '',
    '## Salary',
    'Gross salary: 5000',
    'Contributions: 650',
    'Tax: 0',
    '',
    '## Income',
    'Child benefit: 300 (Benefits)',
    '',
    '## Expenses',
    'Rent: 1500 (Housing)',
    'Groceries: 600 (Groceries and household)',
    'Health insurance: 350 (Health and insurance)',
    'Phone: 50',
    '',
    '## Savings',
    'Monthly payment / current balance',
    'Savings account: 200 / 5000',
    '',
    '## Debts',
    'Monthly repayment / left to pay',
    'Car loan: 300 / 9000',
    '',
    '## Wishes',
    'Bike: 900',
    ''
  ].join('\n');

  /* Document Word simple à partir du texte du modèle (titres ## en gras). */
  function textDocx(text) {
    var body = text.split('\n').map(function (l) {
      var h1 = /^# /.test(l), h2 = /^## /.test(l), s = l.replace(/^#+\s*/, '');
      return '<w:p><w:pPr><w:spacing w:before="' + (h2 ? 200 : 0) + '" w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' + (h1 || h2 ? '<w:b/>' : '') +
        '<w:sz w:val="' + (h1 ? 32 : h2 ? 26 : 22) + '"/></w:rPr><w:t xml:space="preserve">' + xmlEsc((h2 ? '## ' : h1 ? '# ' : '') + s) + '</w:t></w:r></w:p>';
    }).join('');
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/document.xml', data: doc }
    ]);
  }

  $('sd-merge').addEventListener('click', function () { applyDraft('merge'); });
  $('sd-replace').addEventListener('click', function () { applyDraft('replace'); });
  $('sd-cancel').addEventListener('click', function () { hidePanels(); msg(''); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-template]') : null;
    if (b) template(b.getAttribute('data-template'));
  });

  /* ---------- Lecture d'un PDF quelconque (pdf.js, chargé à la demande) ---------- */
  var pdfjs = null;
  function pdfLines(buf) {
    var load = pdfjs ? Promise.resolve(pdfjs) : import(base + 'JavaScript/vendor/pdfjs/pdf.min.mjs').then(function (m) {
      m.GlobalWorkerOptions.workerSrc = base + 'JavaScript/vendor/pdfjs/pdf.worker.min.mjs';
      pdfjs = m;
      return m;
    });
    return load.then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
    }).then(function (doc) {
      var jobs = [];
      for (var p = 1; p <= Math.min(doc.numPages, 60); p++) jobs.push(doc.getPage(p).then(function (pg) { return pg.getTextContent(); }));
      return Promise.all(jobs);
    }).then(function (contents) {
      var lines = [];
      lines.cells = [];
      contents.forEach(function (c) {
        var rows = {};
        c.items.forEach(function (it) {
          if (!it.str || !it.str.trim()) return;
          var key = Math.round(it.transform[5] / 3);
          (rows[key] = rows[key] || []).push({ x: it.transform[4], s: it.str });
        });
        Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (k) {
          var cells = rows[k].sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s.trim(); });
          lines.push(cells.join('  '));
          lines.cells.push(cells);
        });
      });
      return lines;
    });
  }

  /* ---------- Montants et dates ---------- */
  function parseAmount(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v || '').trim();
    if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-|-$|^−|−$/.test(s.replace(/\s|[A-Za-z€$£]/g, ''));
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return null;
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    var dec = Math.max(lastDot, lastComma);
    if (dec !== -1 && s.length - dec - 1 >= 1 && s.length - dec - 1 <= 2) {
      s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
    } else s = s.replace(/[.,]/g, '');
    var n = parseFloat(s);
    return isFinite(n) ? (neg ? -n : n) : null;
  }
  function parseDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      var d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return d.toISOString().slice(0, 10);
    }
    var s = String(v || '').trim(), m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
    if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/.exec(s))) {
      var y = m[3].length === 2 ? '20' + m[3] : m[3];
      if (+m[2] > 12 && +m[1] <= 12) return y + '-' + pad(m[1]) + '-' + pad(m[2]);
      return y + '-' + pad(m[2]) + '-' + pad(m[1]);
    }
    return null;
  }
  function pad(x) { return String(x).padStart(2, '0'); }

  /* ---------- Catégorie devinée d'après le libellé ---------- */
  var GUESS = [
    [/loyer|rent\b|miete|immo|régie|regie|hypoth|électricité|electricite|electricity|chauffage|heating|strom|nebenkosten|heizung/i, 'Logement', 'out'],
    [/migros|coop|denner|lidl|aldi|carrefour|leclerc|auchan|intermarch|monoprix|manor food|spar|volg|supermarch|épicerie|epicerie|courses|groceries|grocery|supermarket|lebensmittel|einkauf/i, 'Courses et ménage', 'out'],
    [/sbb|cff|tpg|tl |ratp|sncf|uber|bolt|taxi|navigo|bus|tram|train/i, 'Transports', 'out'],
    [/essence|carburant|fuel|shell|esso|bp |totalenergies|agrola|avia|parking|garage|tcs|leasing|voiture|auto|car loan|benzin/i, 'Véhicule', 'out'],
    [/swisscom|sunrise|salt|orange|free|sfr|bouygues|yallo|wingo|internet|mobile|t[ée]l[ée]phone|phone/i, 'Téléphone et internet', 'out'],
    [/netflix|spotify|disney|apple|google|amazon prime|youtube|deezer|abonnement|subscription/i, 'Abonnements', 'out'],
    [/assurance|insurance|versicherung|krankenkasse|helsana|css|groupe mutuel|swica|sanitas|visana|assura|mutuelle|axa|allianz|zurich|generali|mobilière|baloise/i, 'Santé et assurances', 'out'],
    [/médecin|medecin|pharmac|dentist|hôpital|hopital|doctor/i, 'Santé et assurances', 'out'],
    [/impôt|impot|tax|steuer|afc|dgfip/i, 'Impôts', 'out'],
    [/restaurant|resto|repas|café|cafe|bar |cinema|cinéma|mcdonald|burger|pizza|starbucks|loisir|gym|fitness|sport|leisure/i, 'Loisirs et sorties', 'out'],
    [/frais|fee|commission|cotisation carte|tenue de compte|geb[üu]hr|kontof[üu]hrung/i, 'Frais bancaires', 'out'],
    [/\bdon\b|dons|donation|spende/i, 'Dons', 'out'],
    [/salaire|salary|lohn|paie|payroll/i, 'Salaire', 'inc'],
    [/allocation|caf |rente|pension|benefit|allowance|kindergeld|zulage|familiale|family/i, 'Allocations', 'inc'],
    [/[ée]pargne|savings|3e pilier|pilier 3a|s[äa]ule 3a|sparkonto|livret|pillar 3a/i, 'Épargne', 'out'],
    [/virement (interne|entre (mes )?comptes|vers (mon|ma|mes)|de (mon|ma) compte)|compte [àa] compte|transfert interne|internal transfer|own account|between (my )?accounts|eigenes konto|konto[üu]bertrag|[üu]bertrag/i, 'Virement interne', 'both']
  ];
  /* Catégorie d'après le libellé : d'abord ce que la personne a déjà choisi, puis les mots connus. */
  function guess(label, amount) {
    var l = A.learned ? A.learned(label) : null;
    if (l) return { cat: l, type: A.IN_CATS.indexOf(l) !== -1 && l !== 'Virement interne' ? 'inc' : (l === 'Virement interne' ? (amount > 0 ? 'inc' : 'out') : 'out'), known: true };
    for (var i = 0; i < GUESS.length; i++) {
      if (GUESS[i][0].test(label)) return { cat: GUESS[i][1], type: GUESS[i][2] === 'both' ? (amount > 0 ? 'inc' : 'out') : GUESS[i][2], known: true };
    }
    return { cat: amount > 0 ? 'Autre revenu' : 'Divers', type: amount > 0 ? 'inc' : 'out', known: false };
  }
  /* Catégorie compatible avec le sens de l'opération (une rentrée ne peut pas être classée en Logement). */
  function catFor(g, type) {
    if (g.type === type || g.cat === 'Virement interne') return g.cat;
    return type === 'inc' ? 'Autre revenu' : 'Divers';
  }

  /* ---------- Relevé : tableau (CSV, Excel, Markdown) ---------- */
  var current = null;   // { name, rows, map, lines }

  function guessMap(rows) {
    var head = (rows[0] || []).map(function (h) { return String(h).toLowerCase(); });
    var body = rows.slice(1, 40);
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([0]));
    var used = [];
    var find = function (re) {
      for (var i = 0; i < head.length; i++) if (used.indexOf(i) === -1 && re.test(head[i])) { used.push(i); return i; }
      return -1;
    };
    var map = {};
    map.date = find(/date|datum|jour|day|valuta|valeur|booking/);
    map.amount = find(/^montant|^amount|^betrag|^importo|^somme|^sum/);
    map.debit = find(/débit|debit|belastung|retrait|withdraw|ausgang|out$/);
    map.credit = find(/crédit|credit|gutschrift|dépôt|depot|deposit|eingang|in$/);
    map.label = find(/libell|descr|texte|text|détail|detail|motif|bénéf|benef|payee|buchungstext|mitteilung|communication|label/);
    if (map.label === -1) map.label = find(/operation|opération|nom|name/);
    var score = function (fn) { var best = -1, bs = 0; for (var c = 0; c < cols; c++) { var s = body.filter(function (r) { return fn(r[c]); }).length; if (s > bs) { bs = s; best = c; } } return best; };
    if (map.date === -1) map.date = score(function (v) { return parseDate(v) !== null; });
    if (map.amount === -1 && map.debit === -1 && map.credit === -1) map.amount = score(function (v) { return parseAmount(v) !== null && String(v).replace(/\D/g, '').length < 12 && parseDate(v) === null; });
    if (map.label === -1) {
      var bestLen = 0;
      for (var c = 0; c < cols; c++) {
        if (c === map.date || c === map.amount || c === map.debit || c === map.credit) continue;
        var len = body.reduce(function (s, r) { return s + String(r[c] || '').length; }, 0);
        if (len > bestLen) { bestLen = len; map.label = c; }
      }
    }
    map.header = find(/./) !== -1 && rows.length > 1 && parseDate(rows[0][map.date]) === null;
    return map;
  }

  function linesFromRows(rows, map) {
    var out = [];
    rows.slice(map.header ? 1 : 0).forEach(function (r) {
      var amount = null;
      if (map.amount >= 0) amount = parseAmount(r[map.amount]);
      else {
        var d = map.debit >= 0 ? parseAmount(r[map.debit]) : null, c = map.credit >= 0 ? parseAmount(r[map.credit]) : null;
        if (d) amount = -Math.abs(d); else if (c) amount = Math.abs(c);
      }
      if (amount === null || amount === 0) return;
      var label = map.label >= 0 ? String(r[map.label] || '').trim() : '';
      var g = guess(label, amount), type = amount < 0 ? 'out' : 'inc';
      out.push({ date: map.date >= 0 ? parseDate(r[map.date]) : null, label: label.slice(0, 80), amount: Math.abs(amount), type: type, cat: catFor(g, type), on: true });
    });
    return out;
  }

  function statementFromRows(rows, name) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (c) { return String(c).trim() !== ''; }); });
    if (rows.length < 1) { msg(t('import.nothing')); return; }
    var map = guessMap(rows);
    current = { name: name, rows: rows, map: map, lines: linesFromRows(rows, map) };
    showStatement();
  }

  /* ---------- Relevé : PDF ---------- */
  function statementFromLines(lines, name) {
    var dateRe = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\s+/;
    var amtRe = /[-−]?\(?\d{1,3}(?:[ '’.,  ]\d{3})*[.,]\d{2}\)?[-−]?/g;
    var out = [];
    lines.forEach(function (l) {
      var m = dateRe.exec(l);
      if (!m) return;
      var rest = l.slice(m[0].length).replace(/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s+/, '');
      var amounts = rest.match(amtRe);
      if (!amounts) return;
      var pick = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
      var amount = parseAmount(pick);
      if (amount === null || amount === 0) return;
      var label = rest.slice(0, rest.indexOf(amounts[0])).trim().replace(/\s{2,}/g, ' ');
      var g = guess(label, amount);
      var type = amount < 0 ? 'out' : g.type;
      out.push({ date: parseDate(m[1]), label: label.slice(0, 80) || '-', amount: Math.abs(amount), type: type, cat: catFor(g, type), on: true });
    });
    if (!out.length) { msg(t('import.pdfNothing')); return; }
    current = { name: name, rows: null, map: null, lines: out };
    showStatement();
  }

  /* ---------- Aperçu et ajout ---------- */
  function showStatement() {
    if (!A.state) {
      // Pas encore de budget : on en crée un avec le pays et la devise choisis à l'accueil.
      var cc = ($('setup-country') && $('setup-country').value) || 'XX', cur0 = ($('setup-cur') && $('setup-cur').value) || 'EUR', m0 = thisMonth(), months = {};
      months[m0] = { accounts: [{ name: t('mainAccount'), bank: '', cur: cur0, sal: null, inc: [], out: [] }], sav: [], debt: [], wish: [] };
      A.replace({ v: 2, country: window.BUDGET_COUNTRIES[cc] ? cc : 'XX', base: cur0, rates: {}, rateSrc: {}, cur: m0, months: months, log: [] }, '');
    }
    msg('');
    if (location.hash !== '#reglages') location.hash = '#reglages';
    var box = $('statement');
    box.hidden = false;
    $('st-title').textContent = t('st.title', { name: current.name });
    var d = A.state.months[A.state.cur];
    $('st-account').innerHTML = d.accounts.map(function (a, i) { return '<option value="' + i + '">' + esc(a.name + (a.bank ? ' · ' + a.bank : '') + ' (' + a.cur + ')') + '</option>'; }).join('') +
      '<option value="new">' + esc(t('st.newAccount')) + '</option>';
    var mapBox = $('st-map');
    if (current.rows) {
      var cols = Math.max.apply(null, current.rows.map(function (r) { return r.length; }));
      var head = current.map.header ? current.rows[0] : [];
      var opts = function (sel) {
        var o = '<option value="-1">' + esc(t('st.none')) + '</option>';
        for (var c = 0; c < cols; c++) o += '<option value="' + c + '"' + (c === sel ? ' selected' : '') + '>' + esc((head[c] ? String(head[c]) : t('st.col', { n: c + 1 })).slice(0, 40)) + '</option>';
        return o;
      };
      mapBox.hidden = false;
      ['date', 'label', 'amount', 'debit', 'credit'].forEach(function (k) { $('st-map-' + k).innerHTML = opts(current.map[k]); });
      $('st-header').checked = !!current.map.header;
    } else mapBox.hidden = true;
    current.salaryReplace = false;
    salaryCheck(true);
    renderLines();
    box.scrollIntoView();
  }

  /* Le compte choisi a déjà un salaire brut : les lignes de salaire du relevé le compteraient deux fois.
     Elles sont décochées, sauf si la personne choisit de remplacer le détail du salaire. */
  function targetAccount() {
    var S = A.state, sel = $('st-account').value;
    return sel === 'new' ? null : S.months[S.cur].accounts[+sel];
  }
  function salaryCheck(reset) {
    var a = targetAccount(), box = $('st-salary');
    var has = !!(a && a.sal && a.sal.brut > 0);
    var lines = current.lines.filter(function (l) { return l.type === 'inc' && l.cat === 'Salaire'; });
    box.hidden = !(has && lines.length);
    if (!box.hidden) {
      $('st-salary-text').textContent = t('st.salaryWarn', { name: a.name, amount: A.fmt(a.sal.brut, a.cur), n: lines.length });
      $('st-salary-replace').checked = !!current.salaryReplace;
    }
    if (reset || has) lines.forEach(function (l) { l.on = !has || !!current.salaryReplace; });
  }

  function renderLines() {
    var lines = current.lines, cats = A.outCats(), incs = A.IN_CATS;
    $('st-count').textContent = lines.length ? t('st.count', { n: lines.length }) : t('import.nothing');
    $('st-lines').innerHTML = lines.length ? '<table class="history-table st-table"><thead><tr><th scope="col"><span class="visually-hidden">' + t('st.keep') + '</span></th><th scope="col">' + t('st.date') + '</th><th scope="col">' + t('col.label') + '</th><th scope="col">' + t('st.type') + '</th><th scope="col">' + t('col.cat') + '</th><th scope="col">' + t('col.amount') + '</th></tr></thead><tbody>' +
      lines.map(function (l, i) {
        var list = l.type === 'inc' ? incs : cats;
        return '<tr><td><input type="checkbox" data-st="' + i + '" data-f="on"' + (l.on ? ' checked' : '') + ' aria-label="' + esc(t('st.keep')) + '"></td>' +
          '<td>' + esc(l.date || '-') + '</td><td class="st-label">' + esc(l.label) + '</td>' +
          '<td><select data-st="' + i + '" data-f="type" aria-label="' + esc(t('st.type')) + '"><option value="out"' + (l.type === 'out' ? ' selected' : '') + '>' + t('st.out') + '</option><option value="inc"' + (l.type === 'inc' ? ' selected' : '') + '>' + t('st.inc') + '</option></select></td>' +
          '<td><select data-st="' + i + '" data-f="cat" aria-label="' + esc(t('col.cat')) + '">' + list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === l.cat ? ' selected' : '') + '>' + esc(I.cat(c)) + '</option>'; }).join('') + '</select></td>' +
          '<td>' + A.plain(l.amount) + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
    $('st-add').disabled = !lines.some(function (l) { return l.on; });
  }
  function dupKey(l) { return (l.d || '') + '|' + norm(l.label) + '|' + (+l.amount).toFixed(2); }

  function addLines() {
    var S = A.state, sel = $('st-account').value, added = 0, skipped = 0, months = {}, created = [];
    A.beginChange();
    var accName = sel === 'new' ? (current.name.replace(/\.[^.]+$/, '').slice(0, 60) || t('newAccount')) : S.months[S.cur].accounts[+sel].name;
    var template = sel === 'new' ? null : S.months[S.cur].accounts[+sel];
    var chosen = current.lines.filter(function (l) { return l.on; }).slice().sort(function (a, b) { return String(a.date || '').localeCompare(String(b.date || '')); });
    chosen.forEach(function (l) {
      var m = l.date ? l.date.slice(0, 7) : S.cur;
      // Mois absent : même structure de comptes que le mois voisin, mais sans aucune ligne recopiée.
      if (A.ensureBlank(m)) created.push(m);
      var d = S.months[m];
      var a = d.accounts.filter(function (x) { return x.name === accName; })[0];
      if (!a) { a = { name: accName, bank: template ? template.bank : '', cur: template ? template.cur : S.base, sal: null, inc: [], out: [] }; d.accounts.push(a); }
      var item = { label: l.label, cat: l.cat, amount: l.amount };
      if (l.date) item.d = l.date;
      // Même date, même libellé, même montant : la ligne est déjà dans le budget (relevé importé deux fois).
      var key = dupKey(item);
      if (a.inc.concat(a.out).some(function (x) { return dupKey(x) === key; })) { skipped++; return; }
      if (current.salaryReplace && l.type === 'inc' && l.cat === 'Salaire' && a.sal) a.sal = null;
      a[l.type].push(item);
      months[m] = 1; added++;
    });
    A.log('statement', { n: added, name: current.name });
    current = null;
    $('statement').hidden = true;
    var ms = Object.keys(months).sort();
    if (ms.length) A.state.cur = ms[ms.length - 1];
    A.save();
    var text = added ? t('st.added', { n: added, months: ms.map(A.monthName).join(', ') }) : t('st.noneAdded');
    if (skipped) text += ' ' + t('st.skipped', { n: skipped });
    if (created.length) text += ' ' + t('st.created', { months: created.sort().map(A.monthName).join(', ') });
    msg(text);
  }

  /* ---------- Événements ---------- */
  $('st-lines').addEventListener('change', function (e) {
    var el = e.target, i = el.getAttribute('data-st');
    if (i === null) return;
    var l = current.lines[+i], f = el.getAttribute('data-f');
    if (f === 'on') l.on = el.checked;
    else if (f === 'type') { l.type = el.value; l.cat = l.type === 'inc' ? 'Autre revenu' : 'Divers'; renderLines(); }
    else if (f === 'cat') { l.cat = el.value; if (A.learn) A.learn(l.label, el.value); }
    $('st-add').disabled = !current.lines.some(function (x) { return x.on; });
  });
  $('st-map').addEventListener('change', function () {
    ['date', 'label', 'amount', 'debit', 'credit'].forEach(function (k) { current.map[k] = +$('st-map-' + k).value; });
    current.map.header = $('st-header').checked;
    current.lines = linesFromRows(current.rows, current.map);
    renderLines();
  });
  $('st-all').addEventListener('click', function () { var on = !current.lines.every(function (l) { return l.on; }); current.lines.forEach(function (l) { l.on = on; }); renderLines(); });
  $('st-add').addEventListener('click', addLines);
  $('st-account').addEventListener('change', function () { if (current) { salaryCheck(true); renderLines(); } });
  $('st-salary-replace').addEventListener('change', function (e) {
    current.salaryReplace = e.target.checked;
    current.lines.forEach(function (l) { if (l.type === 'inc' && l.cat === 'Salaire') l.on = e.target.checked; });
    renderLines();
  });
  $('st-cancel').addEventListener('click', function () { current = null; $('statement').hidden = true; msg(''); });

  $('export').addEventListener('click', function () { exportAs($('export-format').value, $('export-scope').value); });
  $('export-format').addEventListener('change', function (e) { $('export-scope-wrap').hidden = ['pdf', 'docx', 'md'].indexOf(e.target.value) === -1; });

  function pickFile() { $('import-file').value = ''; $('import-file').click(); }
  $('import').addEventListener('click', pickFile);
  $('setup-import').addEventListener('click', pickFile);
  $('import-file').addEventListener('change', function (e) { importFile(e.target.files && e.target.files[0]); });

  window.BMFiles = { exportAs: exportAs, importFile: importFile, template: template, guess: guess, _test: { parseAmount: parseAmount, parseDate: parseDate, parseMonth: parseMonth, sectionOf: sectionOf, matchCategory: matchCategory, parseTextLines: parseTextLines } };
})();
