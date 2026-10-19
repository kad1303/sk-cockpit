'use strict';

/* ============================================================
   Lieferantenrechnungen auslesen (Wareneingang).
   Tecnifibre: Spalten werden über die Kopfzeile „Product Code … Amount T“ bestimmt.
   Nichts wird gebucht, ohne dass der Nutzer die Positionen bestätigt.
   ============================================================ */

const ShopParse = (() => {
  const num = s => { const t = String(s || '').replace(/\./g, '').replace(',', '.'); const n = parseFloat(t); return isNaN(n) ? null : n; };
  const isPrice = s => /^-?\d{1,3}(\.\d{3})*,\d{2}$/.test(String(s).trim());

  function tecnifibre(lines) {
    const hi = lines.findIndex(l => l.items.some(i => /^Product Code$/i.test(i.s)) && l.items.some(i => /^Quantity$/i.test(i.s)));
    if (hi < 0) return null;
    const hx = name => { const it = lines[hi].items.find(i => new RegExp('^' + name + '$', 'i').test(i.s)); return it ? it.x : null; };
    const code = hx('Product Code'), pname = hx('Product Name'), qty = hx('Quantity'), un = hx('Un'), unit = hx('Unit Price'), net = hx('Net Price'), amt = hx('Amount'), tcol = hx('T');
    if ([code, pname, qty, net, amt].some(v => v === null)) return null;
    // Spaltengrenzen: Code bis zur Mitte zwischen Code- und Namens-Überschrift, sonst kurz vor der jeweiligen Überschrift
    const bounds = [(code + pname) / 2, qty - 6, (un || qty + 40) - 6, (unit || net - 50) - 6, net - 6, amt - 6, (tcol || amt + 50) - 6];
    const col = x => { let c = 0; while (c < bounds.length && x >= bounds[c]) c++; return ['code', 'name', 'qty', 'un', 'unit', 'net', 'amount', 't'][c]; };
    const cells = l => { const o = {}; l.items.forEach(i => { const k = col(i.x); o[k] = o[k] ? o[k] + ' ' + i.s : i.s; }); return o; };

    // Kopf: Rechnungsnummer und Datum
    let nummer = null, datum = null, total = null;
    for (const l of lines) {
      const s = l.items.map(i => i.s);
      if (!nummer) { const f = s.find(x => /^F\d{6,}$/.test(x)); if (f) nummer = f; }
      if (!datum) { const d = s.find(x => /^\d{2}\.\d{2}\.\d{2}$/.test(x)); if (d) { const p = d.split('.'); datum = `20${p[2]}-${p[1]}-${p[0]}`; } }
      if (s[0] && /^Total$/i.test(s.find(x => /^Total$/i.test(x)) || '') ) { const p = s.filter(isPrice); if (p.length) total = num(p[p.length - 1]); }
    }

    const items = [];
    let cur = null;
    for (let i = hi + 1; i < lines.length; i++) {
      const c = cells(lines[i]);
      if (lines[i].items.some(it => /^(VAT Base|Subtotal|Total)$/i.test(it.s))) break;
      // Versandkosten ("PORT-") werden mitgenommen, aber nicht eingelagert
      if (c.code && /^PORT/i.test(c.code.trim())) {
        const p = [c.net, c.amount].map(v => v && v.split(' ').find(isPrice)).filter(Boolean);
        const v = p.length ? num(p[p.length - 1]) : null;
        items.push({ artnr: '', name: 'Versandkosten', kategorie: 'Versand', ean: '', menge: 1, netto: v, betrag: v, listenpreis: null, rabatt: null, lager: false });
        cur = null;
        continue;
      }
      if (c.code && /^[0-9A-Z]{6,}$/.test(c.code.trim())) {
        cur = { lager: true, artnr: c.code.trim(), name: (c.name || '').trim(), kategorie: '', ean: '', menge: num(String(c.qty || '').split(' ').filter(x => /^\d+$/.test(x)).pop()), netto: c.net && isPrice(c.net) ? num(c.net) : null, betrag: c.amount && isPrice(c.amount.split(' ')[0]) ? num(c.amount.split(' ')[0]) : null, listenpreis: c.unit && isPrice(c.unit) ? num(c.unit) : null, rabatt: null };
        items.push(cur);
        continue;
      }
      if (!cur) continue;
      const text = (c.name || '').trim();
      const ean = text.match(/EAN\s+Code\s+(\d{8,14})/i);
      if (ean) { cur.ean = ean[1]; continue; }
      if (/^Remise/i.test(text)) {
        const r = text.match(/(\d+[.,]\d+)\s*%/); if (r) cur.rabatt = num(r[1]);
        if (c.net && isPrice(c.net)) cur.netto = num(c.net);
        if (c.amount && isPrice(c.amount.split(' ')[0])) cur.betrag = num(c.amount.split(' ')[0]);
        continue;
      }
      if (/^(DAP|DE-GERMANY|GERMANY)/i.test(text)) { cur = null; continue; }
      if (text && !cur.kategorie) cur.kategorie = text;
    }
    items.forEach(it => {
      if (it.netto === null && it.betrag !== null && it.menge) it.netto = Math.round(it.betrag / it.menge * 100) / 100;
      if (it.betrag === null && it.netto !== null && it.menge) it.betrag = Math.round(it.netto * it.menge * 100) / 100;
    });
    return { lieferant: 'Tecnifibre', nummer, datum, total, items };
  }

  async function read(file) {
    const lines = await BWA.extractLines(file);
    const all = lines.map(l => l.items.map(i => i.s).join(' ')).join('\n');
    if (/tecnifibre/i.test(all)) {
      const r = tecnifibre(lines);
      if (r && r.items.length) return r;
    }
    throw new Error('Diese Rechnung kann ich noch nicht automatisch lesen. Bisher wird Tecnifibre erkannt – andere Lieferanten kannst du über „Position hinzufügen“ von Hand erfassen.');
  }

  return { read, tecnifibre };
})();
