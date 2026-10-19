'use strict';

/* ============================================================
   BWA-PDF einlesen (DATEV-BWA, Form 1, Jahresübersicht).
   Die PDF wird komplett im Browser ausgewertet.
   ============================================================ */

const DATEV_M = { Jan: 0, Feb: 1, Mrz: 2, 'Mär': 2, Apr: 3, Mai: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Okt: 9, Nov: 10, Dez: 11 };
const REQUIRED = ['umsatz', 'waren', 'rohertrag', 'sbe', 'bro', 'personal', 'raum', 'gk', 'be', 'evs'];
const COST_ITEMS = ['personal', 'raum', 'steuern', 'vers', 'bes', 'kfz', 'werbe', 'kwa', 'afa', 'rep', 'sonst'];
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

const BWA = (() => {
  let pdfReady = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Das PDF-Lesemodul konnte nicht geladen werden. Bist du online?'));
      document.head.appendChild(s);
    });
  }
  function loadPdfJs() {
    if (!pdfReady) {
      pdfReady = loadScript(PDFJS + 'pdf.min.js')
        .then(() => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return window.pdfjsLib; });
      pdfReady.catch(() => { pdfReady = null; });
    }
    return pdfReady;
  }

  const NUM_RE = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
  const toNum = s => parseFloat(s.replace(/\./g, '').replace(',', '.'));

  async function extractLines(file) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const lines = [];
    for (let pn = 1; pn <= doc.numPages; pn++) {
      const page = await doc.getPage(pn);
      const tc = await page.getTextContent();
      const items = tc.items.filter(it => it.str && it.str.trim()).map(it => ({ s: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const pageLines = [];
      for (const it of items) {
        const ln = pageLines.find(l => Math.abs(l.y - it.y) < 2.5);
        if (ln) ln.items.push(it); else pageLines.push({ y: it.y, items: [it] });
      }
      pageLines.forEach(l => l.items.sort((a, b) => a.x - b.x));
      lines.push(...pageLines);
    }
    return lines;
  }

  function parse(lines) {
    const rows = {};
    let header = null, stand = null, erstellt = null, firma = null;
    for (const l of lines) {
      const strs = l.items.map(i => i.s);
      const joined = strs.join(' ').replace(/\s+/g, ' ');
      const mTokens = l.items.filter(i => /^(Jan|Feb|Mrz|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)\/\d{4}$/.test(i.s));
      if (mTokens.length >= 1 && (!header || mTokens.length > header.length)) header = mTokens;
      const st = joined.match(/(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember) (\d{4})\s*-\s*Handelsrecht/);
      if (st) stand = st[1] + ' ' + st[2];
      if (!erstellt) { const e = strs.find(s => /^\d{2}\.\d{2}\.\d{4}$/.test(s)); if (e) erstellt = e; }
      if (!firma) { const f = strs.find(s => /\b(GmbH|UG|AG|KG|e\.\s?K\.|GbR)\b/.test(s) && !/[\/\d]{6,}/.test(s)); if (f) firma = f.trim(); }
      if (!firma) { const f = strs.find(s => /\bSK\b.*\b(Tennis|Fitness)\b/i.test(s)); if (f) firma = f.trim(); }
      const nums = l.items.filter(i => NUM_RE.test(i.s));
      const lbl = l.items.filter(i => !NUM_RE.test(i.s)).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim();
      if (nums.length && ROWS[lbl] && !rows[ROWS[lbl]]) rows[ROWS[lbl]] = nums.map(i => toNum(i.s));
    }
    const checks = [];
    const missing = REQUIRED.filter(k => !rows[k]);
    if (missing.length) {
      const names = Object.entries(ROWS).filter(([, k]) => missing.includes(k)).map(([n]) => n);
      throw new Error('Diese Zeilen fehlen in der PDF: ' + names.join(', ') + '. Ist das eine DATEV-BWA (Form 1, Jahresübersicht)?');
    }
    let n = rows.umsatz.length;
    // Letzte Spalte ist meist die Kumulierung: dann ist sie die Summe der übrigen
    const hasCum = n > 1 && Math.abs(rows.umsatz.slice(0, -1).reduce((a, b) => a + b, 0) - rows.umsatz[n - 1]) < 0.05;
    if (hasCum) n -= 1;
    if (!header || header.length < n) throw new Error('Die Monatsspalten (z. B. „Jan/2026“) wurden nicht gefunden.');
    const months = header.slice(0, n).map(t => DATEV_M[t.s.split('/')[0]]);
    const year = +header[0].s.split('/')[1];
    const out = {};
    for (const [k, arr] of Object.entries(rows)) {
      if (arr.length < n) throw new Error('Zeile „' + Object.keys(ROWS).find(x => ROWS[x] === k) + '“ hat zu wenige Werte.');
      out[k] = arr.slice(0, n);
    }
    // Plausibilitätsprüfungen
    const near = (a, b) => Math.abs(a - b) < 0.05;
    const gl = out.gl || out.umsatz;
    const tests = [
      ['Rohertrag = Gesamtleistung − Wareneinkauf', i => near(out.rohertrag[i], gl[i] - out.waren[i])],
      ['Betrieblicher Rohertrag = Rohertrag + sonstige Erlöse', i => near(out.bro[i], out.rohertrag[i] + out.sbe[i])],
      ['Gesamtkosten = Summe der Kostenarten', i => near(out.gk[i], COST_ITEMS.reduce((s, k) => s + (out[k] ? out[k][i] : 0), 0))],
      ['Betriebsergebnis = Betrieblicher Rohertrag − Gesamtkosten', i => near(out.be[i], out.bro[i] - out.gk[i])]
    ];
    for (const [name, fn] of tests) {
      const bad = months.map((m, i) => fn(i) ? null : MS[m]).filter(Boolean);
      checks.push({ ok: !bad.length, text: name + (bad.length ? ' — Abweichung in ' + bad.join(', ') : '') });
    }
    if (hasCum) {
      const bad = REQUIRED.filter(k => !near(rows[k].slice(0, n).reduce((a, b) => a + b, 0), rows[k][n]));
      checks.push({ ok: !bad.length, text: 'Kumulierte Spalte = Summe der Monate' + (bad.length ? ' — Abweichung bei ' + bad.length + ' Zeilen' : '') });
    }
    // Leere Monate am Jahresanfang weglassen (z. B. Firma erst im März gestartet)
    let skip = 0;
    while (skip < n - 1 && Object.values(out).every(arr => arr[skip] === 0)) skip++;
    if (skip) for (const k in out) out[k] = out[k].slice(skip);
    return { firma, stand: stand || (ML[months[n - 1]] + ' ' + year), erstellt: erstellt || null, year, months: months.slice(skip), rows: out, checks };
  }

  async function read(file) { return parse(await extractLines(file)); }

  return { read, extractLines };
})();
