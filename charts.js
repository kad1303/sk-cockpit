'use strict';

/* ============================================================
   Finanz-Ansicht: Kacheln, Grafiken, „Kurz gesagt“, BWA-Tabelle.
   Übernommen aus dem bisherigen „SK Tennis Base Cockpit“, ergänzt um
   den Vergleich mit dem Vorjahr.
   ============================================================ */

const de0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const de1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const de2 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = v => (v < 0 ? '−' : '') + de0.format(Math.abs(v)) + ' €';
const eurS = v => (v > 0 ? '+' : v < 0 ? '−' : '') + de0.format(Math.abs(v)) + ' €';
const pct = v => de1.format(v) + ' %';
const sgn = (v, f) => (v > 0 ? '+' : v < 0 ? '−' : '±') + f(Math.abs(v));
const tsd = v => (v < 0 ? '−' : '') + de0.format(Math.abs(v) / 1000) + ' Tsd.';
const per100 = v => (v < 0 ? '−' : '') + (Math.abs(v) < 10 ? de2 : de0).format(Math.abs(v)) + ' €';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const MS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const ML = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Zeilen der DATEV-BWA (Form 1): Bezeichnung → Schlüssel
const ROWS = {
  'Umsatzerlöse': 'umsatz', 'Gesamtleistung': 'gl', 'Material-/Wareneinkauf': 'waren', 'Rohertrag': 'rohertrag',
  'So. betr. Erlöse': 'sbe', 'Betrieblicher Rohertrag': 'bro', 'Personalkosten': 'personal', 'Raumkosten': 'raum',
  'Betriebliche Steuern': 'steuern', 'Versicherungen/Beiträge': 'vers', 'Besondere Kosten': 'bes',
  'Fahrzeugkosten (ohne Steuer)': 'kfz', 'Werbe-/Reisekosten': 'werbe', 'Kosten Warenabgabe': 'kwa',
  'Abschreibungen': 'afa', 'Reparatur/Instandhaltung': 'rep', 'Sonstige Kosten': 'sonst', 'Gesamtkosten': 'gk',
  'Betriebsergebnis': 'be', 'Neutraler Aufwand': 'naufw', 'Neutraler Ertrag': 'neutral',
  'Ergebnis vor Steuern': 'evs', 'Steuern Einkommen u. Ertrag': 'eest', 'Vorläufiges Ergebnis': 've'
};

const sum = a => a.reduce((s, v) => s + v, 0);

// Rohdaten einer BWA → abgeleitete Reihen (Einnahmen, Ausgaben, Ergebnis …)
function deriveRows(doc) {
  const N = doc.months.length;
  const z = () => new Array(N).fill(0);
  const B = {};
  for (const k of Object.values(ROWS)) B[k] = (doc.rows[k] && doc.rows[k].length === N) ? doc.rows[k].slice() : z();
  B.uebrige = B.umsatz.map((_, i) => B.steuern[i] + B.vers[i] + B.bes[i] + B.kfz[i] + B.kwa[i] + B.afa[i] + B.rep[i]);
  // Einfache Sicht: Einnahmen = alle Erträge, Ausgaben = alle Kosten, Ergebnis = Einnahmen − Ausgaben (= Ergebnis vor Steuern)
  B.ein = B.umsatz.map((v, i) => v + B.sbe[i] + B.neutral[i]);
  B.aus = B.umsatz.map((_, i) => B.waren[i] + B.gk[i] + B.naufw[i]);
  B.erg = B.ein.map((v, i) => v - B.aus[i]);
  B.sonstAlle = B.umsatz.map((_, i) => B.sonst[i] + B.uebrige[i] + B.naufw[i]);
  return B;
}

const Fin = (() => {
  let D, B, N, mi, cum = [], PY = null, PB = null;
  const S = (k, p) => p === 'cum' ? sum(B[k]) : B[k][p];
  const q = (k, p) => S(k, p) / S('umsatz', p) * 100;
  const qe = (k, p) => S(k, p) / S('ein', p) * 100;
  const ms = i => MS[mi[i]];
  const ml = i => ML[mi[i]];
  const rangeTxt = () => N === 1 ? MS[mi[0]] + ' ' + D.year : `${MS[mi[0]]}–${MS[mi[N - 1]]} ${D.year}`;
  const label = p => p === 'cum' ? rangeTxt() : ml(p) + ' ' + D.year;
  const $ = id => document.getElementById(id);

  function setData(doc, prevYearDoc) {
    D = doc; N = doc.months.length; mi = doc.months;
    B = deriveRows(doc);
    cum = []; B.erg.reduce((s, v, i) => (cum[i] = s + v), 0);
    PY = prevYearDoc || null;
    PB = PY ? deriveRows(PY) : null;
  }

  // Werte des Vorjahres für dieselben Monate (oder null, wenn nicht vorhanden)
  function pyVal(k, p) {
    if (!PY) return null;
    const want = p === 'cum' ? mi : [mi[p]];
    const idx = want.map(m => PY.months.indexOf(m));
    if (idx.some(i => i < 0)) return null;
    return sum(idx.map(i => PB[k][i]));
  }

  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const txt = (attrs, s, parent) => { const t = el('text', attrs, parent); t.textContent = s; return t; };
  function niceStep(range, ticks) {
    const raw = range / ticks, p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
    return 10 * p;
  }
  // Balken mit abgerundetem Ende weg von der Grundlinie
  function barPath(x0, w, yBase, yEnd) {
    const h = Math.abs(yEnd - yBase), r = Math.min(4, h / 2, w / 2), x1 = x0 + w;
    if (h < 0.5) return `M${x0} ${yBase} H${x1}`;
    return yEnd <= yBase
      ? `M${x0} ${yBase} V${yEnd + r} Q${x0} ${yEnd} ${x0 + r} ${yEnd} H${x1 - r} Q${x1} ${yEnd} ${x1} ${yEnd + r} V${yBase} Z`
      : `M${x0} ${yBase} V${yEnd - r} Q${x0} ${yEnd} ${x0 + r} ${yEnd} H${x1 - r} Q${x1} ${yEnd} ${x1} ${yEnd - r} V${yBase} Z`;
  }

  function periodOptions(keep) {
    const opts = `<option value="cum">${rangeTxt()} (alle Monate)</option>` +
      mi.map((_, i) => i).reverse().map(i => `<option value="${i}">${ml(i)} ${D.year}</option>`).join('');
    return { html: opts, value: keep === 'cum' || (keep !== null && keep < N) ? String(keep) : 'cum' };
  }

  function renderMeta(company) {
    const chips = [`Stand: BWA ${esc(D.stand)}`, `vom ${esc(D.erstellt || '–')}`, 'vorläufige Zahlen'];
    $('meta').innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join('');
    $('title').textContent = company.short;
    $('ratio-avg').textContent = 'Ø ' + rangeTxt().replace(' ' + D.year, '');
  }

  // ---------- Große Zahlen ----------
  function renderTiles(p) {
    const E = S('ein', p), A = S('aus', p), R = S('erg', p), r100 = R / E * 100;
    const prev = p !== 'cum' && p > 0 ? p - 1 : null;
    const cmpPct = (cur, old, good, what) => {
      if (!old) return `<span class="cmp">${what}: ${eur(old)}</span>`;
      const d = (cur / old - 1) * 100;
      const cls = d * good > 0 ? 'up' : d * good < 0 ? 'down' : '';
      return `<span class="${cls}">${d > 0 ? '▲' : d < 0 ? '▼' : ''} ${sgn(d, x => de1.format(x))} %</span><span class="cmp">ggü. ${what}</span>`;
    };
    const cmpAbs = (cur, old, what) => `<span class="${cur - old >= 0 ? 'up' : 'down'}">${cur - old >= 0 ? '▲' : '▼'} ${eurS(cur - old)}</span><span class="cmp">ggü. ${what}</span>`;
    const pyLabel = p === 'cum' ? 'Vorjahr' : `${ms(p)} ${D.year - 1}`;
    const pyE = pyVal('ein', p), pyA = pyVal('aus', p), pyR = pyVal('erg', p);
    const pyLine = (v, f) => v === null ? '' : `<div class="delta">${f}</div>`;
    const plus = B.erg.filter(v => v >= 0).length;
    const tiles = [
      { k: 'var(--in)', label: 'Einnahmen', value: eur(E), cls: '',
        what: 'Alles, was reingekommen ist: Umsätze plus sonstige Erträge.',
        delta: prev !== null ? cmpPct(E, B.ein[prev], 1, ms(prev)) : `<span class="cmp">Ø ${eur(sum(B.ein) / N)} pro Monat</span>`,
        py: pyLine(pyE, pyE !== null && cmpPct(E, pyE, 1, pyLabel)) },
      { k: 'var(--out)', label: 'Ausgaben', value: eur(A), cls: '',
        what: 'Alle Kosten: Personal, Waren, Miete, Werbung und Sonstiges.',
        delta: prev !== null ? cmpPct(A, B.aus[prev], -1, ms(prev)) : `<span class="cmp">Ø ${eur(sum(B.aus) / N)} pro Monat</span>`,
        py: pyLine(pyA, pyA !== null && cmpPct(A, pyA, -1, pyLabel)) },
      { k: R >= 0 ? 'var(--c-gewinn)' : 'var(--neg)', label: R >= 0 ? 'Gewinn' : 'Verlust', value: eurS(R), cls: R >= 0 ? 'pos' : 'neg',
        what: 'Einnahmen minus Ausgaben, vor Steuern.',
        delta: prev !== null ? cmpAbs(R, B.erg[prev], ms(prev)) : `<span class="cmp">${plus} von ${N} Monaten im Plus</span>`,
        py: pyLine(pyR, pyR !== null && cmpAbs(R, pyR, pyLabel)) },
      { k: 'var(--accent)', label: 'Übrig von 100 €', value: per100(r100), cls: r100 >= 0 ? '' : 'neg',
        what: 'So viel bleibt von je 100 € Einnahmen als Gewinn übrig.',
        delta: p !== 'cum' ? `<span class="cmp">${rangeTxt()} insgesamt: ${per100(sum(B.erg) / sum(B.ein) * 100)}</span>` : `<span class="cmp">Umsatzrendite ${pct(r100)}</span>`,
        py: pyE ? `<div class="delta"><span class="cmp">${pyLabel}: ${per100(pyR / pyE * 100)}</span></div>` : '' }
    ];
    $('tiles').innerHTML = tiles.map(t => `<article class="tile">
      <div class="label"><i class="sw" style="--k: ${t.k}"></i>${t.label}</div>
      <div class="value num ${t.cls}">${t.value}</div>
      <div class="delta">${t.delta}</div>${t.py}
      <div class="what">${t.what}</div>
    </article>`).join('');
  }

  function makeTip(host) { const t = document.createElement('div'); t.className = 'tip'; t.style.opacity = 0; host.appendChild(t); return t; }
  function placeTip(tip, svg, sx, top) {
    const rect = svg.getBoundingClientRect();
    let left = sx + 12;
    if (left + tip.offsetWidth > rect.width) left = sx - tip.offsetWidth - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = top + 'px';
    tip.style.opacity = 1;
  }

  // ---------- Hauptgrafik: Einnahmen und Ausgaben ----------
  function renderFlow(p) {
    const host = $('flow');
    host.innerHTML = '';
    const W = Math.max(host.clientWidth, 300), H = W < 560 ? 260 : 320;
    const m = { t: 12, r: 8, b: 54, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const top = Math.max(...B.ein, ...B.aus, 1);
    const step = niceStep(top, 5), yMax = Math.ceil(top / step) * step;
    const slot = iw / N;
    const x = i => m.l + i * slot;
    const y = v => m.t + ih - v / yMax * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Einnahmen und Ausgaben je Monat' }, host);
    if (p !== 'cum') el('rect', { x: x(p), y: m.t, width: slot, height: ih + 44, fill: 'var(--hl)', rx: 6 }, svg);
    for (let v = 0; v <= yMax + 0.1; v += step) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: v === 0 ? 'var(--axis)' : 'var(--grid)' }, svg);
      txt({ x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, v ? tsd(v) : '0', svg);
    }
    const bw = Math.min(30, slot * 0.32);
    B.ein.forEach((v, i) => {
      const cx = x(i) + slot / 2;
      el('path', { d: barPath(cx - bw - 1, bw, y(0), y(v)), fill: 'var(--in)' }, svg);
      el('path', { d: barPath(cx + 1, bw, y(0), y(B.aus[i])), fill: 'var(--out)' }, svg);
      txt({ x: cx, y: H - m.b + 18, 'text-anchor': 'middle', style: 'fill: var(--ink-2); font-size: 12px' }, ms(i), svg);
      const r = B.erg[i];
      txt({ x: cx, y: H - m.b + 38, 'text-anchor': 'middle', style: `fill: var(${r >= 0 ? '--good' : '--crit'}); font-weight: 600; font-size: ${slot < 70 ? 10 : 12}px` },
        slot < 70 ? (r >= 0 ? '+' : '−') + de1.format(Math.abs(r) / 1000) + 'T' : eurS(r), svg);
    });
    const tip = makeTip(host);
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih + 44, fill: 'transparent' }, svg);
    const hov = el('rect', { y: m.t, width: slot, height: ih + 44, rx: 6, fill: 'var(--hl)', opacity: 0, 'pointer-events': 'none' }, svg);
    const show = evt => {
      const rect = svg.getBoundingClientRect();
      const px = (evt.clientX - rect.left) * W / rect.width;
      const i = Math.max(0, Math.min(N - 1, Math.floor((px - m.l) / slot)));
      hov.setAttribute('x', x(i)); hov.setAttribute('opacity', 1);
      tip.innerHTML = `<div class="t-h">${ml(i)} ${D.year}</div>
        <div class="t-r"><span>Einnahmen</span><span>${eur(B.ein[i])}</span></div>
        <div class="t-r"><span>Ausgaben</span><span>${eur(B.aus[i])}</span></div>
        <div class="t-r"><span>${B.erg[i] >= 0 ? 'Gewinn' : 'Verlust'}</span><span class="${B.erg[i] >= 0 ? 'up' : 'down'}">${eurS(B.erg[i])}</span></div>`;
      placeTip(tip, svg, (x(i) + slot) * rect.width / W, 6);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.style.opacity = 0; hov.setAttribute('opacity', 0); });
  }

  // ---------- Wohin gehen 100 € ----------
  function renderHundred(p) {
    const E = S('ein', p), A = S('aus', p), R = E - A;
    const cats = [
      { n: 'Personal', d: 'Löhne, Gehälter und Sozialabgaben', k: 'var(--c-pers)', v: S('personal', p) },
      { n: 'Waren und Material', d: 'Einkauf von Waren und Material', k: 'var(--c-ware)', v: S('waren', p) },
      { n: 'Miete und Räume', d: 'Miete, Nebenkosten, Energie', k: 'var(--c-raum)', v: S('raum', p) },
      { n: 'Werbung und Reisen', d: 'Werbung, Reise- und Bewirtungskosten', k: 'var(--c-werb)', v: S('werbe', p) },
      { n: 'Sonstiges', d: 'Büro, Beratung, Versicherungen, Fahrzeug u. a.', k: 'var(--c-sonst)', v: S('sonstAlle', p) }
    ];
    if (R > 0) cats.push({ n: 'Gewinn', d: 'bleibt übrig', k: 'var(--c-gewinn)', v: R });
    const T = Math.max(E, A);
    $('hundred-sub').textContent = `${label(p)}. Grundlage sind alle Einnahmen im Zeitraum: ${eur(E)}.` +
      (R < 0 ? ` Es wurde mehr ausgegeben als eingenommen: auf 100 € Einnahmen kamen ${per100(A / E * 100)} Ausgaben.` : '');
    const segs = cats.filter(c => c.v > 0).map(c => {
      const w = c.v / T * 100, e100 = c.v / E * 100;
      return `<div class="seg" style="--k: ${c.k}; width: ${w}%" title="${c.n}: ${per100(e100)} von 100 €">${w > 9 ? de0.format(e100) + ' €' : ''}</div>`;
    }).join('');
    const mark = R < 0 ? `<div class="mark" style="left: ${E / T * 100}%"><span>100 € Einnahmen</span></div>` : '';
    const list = cats.map(c => `<li><i class="sw" style="--k: ${c.k}"></i><span>${c.n} <small>· ${c.d}</small></span><span class="eur100">${per100(c.v / E * 100)}</span><span class="abs">${eur(c.v)}</span></li>`).join('') +
      (R < 0 ? `<li><i class="sw" style="--k: var(--neg)"></i><span>Verlust <small>· fehlt am Ende</small></span><span class="eur100 down">${per100(R / E * 100)}</span><span class="abs down">${eur(R)}</span></li>` : '');
    $('hundred').innerHTML = `<div class="hbar" role="img" aria-label="Aufteilung von 100 Euro Einnahmen" style="${R < 0 ? 'margin-top: 18px' : ''}">${segs}${mark}</div><ul class="hlist">${list}</ul>`;
  }

  // ---------- Gewinn und Verlust ----------
  function renderResult(p) {
    const host = $('result');
    host.innerHTML = '';
    const W = Math.max(host.clientWidth, 280), H = W < 500 ? 250 : 290;
    const m = { t: 14, r: 12, b: 26, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const lo = Math.min(0, ...B.erg, ...cum), hi = Math.max(0, ...B.erg, ...cum);
    const step = niceStep((hi - lo) || 1, 5);
    const yMin = Math.floor(lo / step) * step, yMax = Math.ceil(hi / step) * step || step;
    const x = i => m.l + (i + 0.5) * iw / N;
    const y = v => m.t + (yMax - v) / (yMax - yMin) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Gewinn und Verlust je Monat' }, host);
    if (p !== 'cum') el('rect', { x: m.l + p * iw / N, y: m.t, width: iw / N, height: ih, fill: 'var(--hl)' }, svg);
    for (let v = yMin; v <= yMax + 0.1; v += step) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: Math.abs(v) < 0.01 ? 'var(--axis)' : 'var(--grid)' }, svg);
      txt({ x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, Math.abs(v) < 0.01 ? '0' : tsd(v), svg);
    }
    mi.forEach((_, i) => { if (W < 420 && N > 8 && i % 2) return; txt({ x: x(i), y: H - 8, 'text-anchor': 'middle' }, ms(i), svg); });
    const bw = Math.min(34, iw / N * 0.56);
    B.erg.forEach((v, i) => el('path', { d: barPath(x(i) - bw / 2, bw, y(0), y(v)), fill: v >= 0 ? 'var(--accent)' : 'var(--neg)' }, svg));
    const cpath = cum.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    el('path', { d: cpath, fill: 'none', stroke: 'var(--ink)', 'stroke-width': 2, 'stroke-dasharray': '5 4', 'stroke-linejoin': 'round' }, svg);
    el('circle', { cx: x(N - 1), cy: y(cum[N - 1]), r: 4, fill: 'var(--ink)', stroke: 'var(--card)', 'stroke-width': 2 }, svg);
    txt({ x: x(N - 1) - 8, y: y(cum[N - 1]) - 9, 'text-anchor': 'end', style: 'fill: var(--ink); font-weight: 600; font-size: 12px' }, 'zusammen ' + eurS(cum[N - 1]), svg);
    const tip = makeTip(host);
    const hit = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, svg);
    const hov = el('rect', { y: m.t, height: ih, width: iw / N, fill: 'var(--hl)', opacity: 0, 'pointer-events': 'none' }, svg);
    const show = evt => {
      const rect = svg.getBoundingClientRect();
      const px = (evt.clientX - rect.left) * W / rect.width;
      const i = Math.max(0, Math.min(N - 1, Math.floor((px - m.l) / (iw / N))));
      hov.setAttribute('x', m.l + i * iw / N); hov.setAttribute('opacity', 1);
      tip.innerHTML = `<div class="t-h">${ml(i)} ${D.year}</div>
        <div class="t-r"><span>${B.erg[i] >= 0 ? 'Gewinn' : 'Verlust'}</span><span class="${B.erg[i] < 0 ? 'down' : 'up'}">${eurS(B.erg[i])}</span></div>
        <div class="t-r"><span>seit Januar zusammen</span><span>${eurS(cum[i])}</span></div>`;
      placeTip(tip, svg, x(i) * rect.width / W, 6);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.style.opacity = 0; hov.setAttribute('opacity', 0); });
  }

  // ---------- Kurz gesagt ----------
  function renderPoints() {
    const items = [];
    const L = N - 1, total = sum(B.erg), E = sum(B.ein);
    const best = B.erg.indexOf(Math.max(...B.erg));
    let t = total >= 0
      ? `<b>${rangeTxt()} insgesamt ${total / E * 100 < 3 ? 'knapp ' : ''}im Plus:</b> ${eurS(total)}.`
      : `<b>${rangeTxt()} insgesamt im Minus:</b> ${eurS(total)}.`;
    if (total > 0 && B.erg[best] > total) t += ` Der ${ml(best)} allein brachte ${eurS(B.erg[best])}, die übrigen Monate haben davon wieder etwas aufgezehrt.`;
    const pyTotal = pyVal('erg', 'cum');
    if (pyTotal !== null) t += ` Im gleichen Zeitraum ${D.year - 1}: ${eurS(pyTotal)}.`;
    items.push([total < 0 ? 'crit' : total / E * 100 < 3 ? 'warn' : 'good', total < 0 ? '−' : total / E * 100 < 3 ? '!' : '✓', t]);
    let streak = 0; for (let i = L; i >= 0 && B.erg[i] < 0; i--) streak++;
    const neg = B.erg.filter(v => v < 0).length;
    if (streak >= 2) items.push(['crit', '−', `<b>Seit ${ml(N - streak)} jeden Monat Verlust,</b> zusammen ${eurS(sum(B.erg.slice(N - streak)))}.`]);
    else if (neg) items.push(['warn', '!', `<b>${neg} von ${N} Monaten mit Verlust.</b> ${ml(L)}: ${eurS(B.erg[L])}.`]);
    else items.push(['good', '✓', `<b>Jeder Monat mit Gewinn.</b>`]);
    const pq = B.personal.map((v, i) => B.ein[i] ? v / B.ein[i] * 100 : 0);
    const pmax = pq.indexOf(Math.max(...pq));
    items.push(['info', 'i', `<b>Größter Ausgabenposten ist das Personal:</b> von 100 € Einnahmen gehen ${de0.format(qe('personal', 'cum'))} € in Löhne und Gehälter, im ${ml(pmax)} sogar ${de0.format(pq[pmax])} €.`]);
    if (N > 1) {
      const avg = E / N, d = (B.ein[L] / avg - 1) * 100;
      const isMin = B.ein[L] === Math.min(...B.ein);
      items.push([d < -10 ? 'warn' : 'good', d < -10 ? '!' : '✓',
        `<b>Einnahmen im ${ml(L)}: ${eur(B.ein[L])}${isMin ? ', so wenig wie in keinem anderen Monat' : ''}.</b> Das sind ${pct(Math.abs(d))} ${d < 0 ? 'weniger' : 'mehr'} als im Schnitt (${eur(avg)}).`]);
    }
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const wq = B.waren.map((v, i) => B.ein[i] ? v / B.ein[i] * 100 : 0), wavg = qe('waren', 'cum'), wm = med(B.werbe);
    const fx = [];
    B.ein.forEach((_, i) => {
      if (wq[i] > wavg + 4) fx.push(`${eur(B.waren[i])} Wareneinkauf im ${ml(i)}`);
      if (B.werbe[i] > 1000 && B.werbe[i] > 3 * wm) fx.push(`${eur(B.werbe[i])} Werbung und Reisen im ${ml(i)}`);
    });
    if (fx.length) items.push(['info', 'i', `<b>Einmalig hohe Ausgaben:</b> ${fx.join(', ')}.`]);
    $('points').innerHTML = items.slice(0, 5).map(([c, ic, s]) =>
      `<li><span class="ic ${c}" aria-hidden="true">${ic}</span><p>${s}</p></li>`).join('');
  }

  // ---------- Details ----------
  function renderRatios(p) {
    $('ratio-col').textContent = p === 'cum' ? 'gesamt' : ms(p);
    const defs = [
      ['Wareneinsatzquote', 'Anteil des Wareneinkaufs am Umsatz', 'waren', -1],
      ['Rohertragsquote', 'Was nach dem Wareneinkauf vom Umsatz bleibt', 'rohertrag', 1],
      ['Personalkostenquote', 'Anteil der Personalkosten am Umsatz', 'personal', -1],
      ['Raumkostenquote', 'Anteil von Miete und Räumen am Umsatz', 'raum', -1],
      ['Kostenquote', 'Alle Kosten außer Waren im Verhältnis zum Umsatz', 'gk', -1],
      ['Umsatzrendite', 'Gewinn vor Steuern im Verhältnis zum Umsatz', 'evs', 1]
    ];
    $('ratios').innerHTML = defs.map(([n, d, k, good]) => {
      const cur = q(k, p), avg = q(k, 'cum');
      let cls = '', arrow = '';
      if (p !== 'cum') {
        const dd = cur - avg;
        if (Math.abs(dd) >= 0.5) { cls = dd * good > 0 ? 'up' : 'down'; arrow = dd > 0 ? '▲ ' : '▼ '; }
      }
      return `<tr><td>${n}</td><td class="sub">${d}</td><td class="r num ${cls}">${arrow}${pct(cur)}</td><td class="r num" style="color: var(--ink-2)">${pct(avg)}</td></tr>`;
    }).join('');
  }

  function renderBWA(p) {
    const rows = [
      ['Umsatzerlöse', 'umsatz', ''], ['Material-/Wareneinkauf', 'waren', ''], ['Rohertrag', 'rohertrag', 'sum'],
      ['Sonstige betriebliche Erlöse', 'sbe', ''], ['Betrieblicher Rohertrag', 'bro', 'sum'],
      ['Personalkosten', 'personal', ''], ['Raumkosten', 'raum', ''], ['Werbe-/Reisekosten', 'werbe', ''],
      ['Sonstige Kosten', 'sonst', ''], ['Kfz, Versicherung, Steuern, AfA, Rep.', 'uebrige', ''],
      ['Gesamtkosten', 'gk', 'sum'], ['Betriebsergebnis', 'be', 'sum key'], ['Neutraler Aufwand', 'naufw', ''],
      ['Neutraler Ertrag', 'neutral', ''], ['Ergebnis vor Steuern', 'evs', 'sum key']
    ].filter(([, k, c]) => c || B[k].some(v => v !== 0));
    const sel = i => (p === i ? ' sel' : '');
    let h = '<thead><tr><th>BWA-Position</th>' + mi.map((_, i) => `<th class="r${sel(i)}">${ms(i)}</th>`).join('') + `<th class="r tot${p === 'cum' ? ' sel' : ''}">${rangeTxt().replace(' ' + D.year, '')}</th></tr></thead><tbody>`;
    rows.forEach(([n, k, c]) => {
      h += `<tr class="${c}"><td>${n}</td>` + B[k].map((v, i) => `<td class="r${sel(i)}${v < 0 ? ' neg' : ''}">${eur(v)}</td>`).join('');
      const t = sum(B[k]);
      h += `<td class="r tot${p === 'cum' ? ' sel' : ''}${t < 0 ? ' neg' : ''}">${eur(t)}</td></tr>`;
    });
    $('bwa').innerHTML = h + '</tbody>';
  }

  function renderPeriod(p) {
    renderTiles(p); renderFlow(p); renderHundred(p); renderResult(p); renderRatios(p); renderBWA(p);
  }
  function redrawCharts(p) { renderFlow(p); renderResult(p); }

  // Kurzzahlen für die Firmenkarten
  function summary(doc) {
    const b = deriveRows(doc), n = doc.months.length;
    return { erg: sum(b.erg), ein: sum(b.ein), range: n === 1 ? `${MS[doc.months[0]]} ${doc.year}` : `${MS[doc.months[0]]}–${MS[doc.months[n - 1]]} ${doc.year}`, last: b.erg[n - 1], lastName: ML[doc.months[n - 1]] };
  }

  return { setData, periodOptions, renderMeta, renderPoints, renderPeriod, redrawCharts, summary, rangeTxt: () => rangeTxt() };
})();
