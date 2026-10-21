'use strict';

/* ============================================================
   Shop / Warenwirtschaft (nur Admin): Bestand, Wareneingang, Rechnungen, Aufträge.
   Rechnungen: Nummer + Summen + Bestandsbuchung macht die Datenbank (shop_create_invoice),
   danach ist die Rechnung unveränderbar. Korrektur nur per Storno.
   ============================================================ */

const FIRMA = {
  name: 'SK Tennis Base GmbH',
  strasse: 'Auf dem Wingertsberg 31',
  ort: '65817 Eppstein',
  tel: '0151 12384259',
  mail: 'info@sktennisbase.de',
  web: 'www.sktennisbase.de',
  steuernr: '04324115598',
  ustid: 'DE352874101',
  register: 'Amtsgericht Königstein im Taunus, HRB 12413',
  gf: 'Philipp Seisler & Kevin Kaufmann',
  bank: 'Frankfurter Volksbank',
  iban: 'DE69 5019 0000 6103 1041 55',
  bic: 'FFVBDEFFXXX',
  zahlung: 'Zahlbar sofort ohne Abzug.',
};

const Shop = (() => {
  const $ = id => document.getElementById(id);
  const m2 = v => (v < 0 ? '−' : '') + de2.format(Math.abs(v)) + ' €';
  const r2 = v => Math.round(v * 100) / 100;
  const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const deDate = iso => iso ? iso.split('-').reverse().join('.') : '';
  const nr = n => 'S ' + n;
  let view = 'bestand', host = null;
  const D = { articles: [], invoices: [], orders: [], customers: [] };

  async function loadAll() {
    const [a, i, o, c] = await Promise.all([
      Auth.select('shop_articles', 'select=*&order=name'),
      Auth.select('shop_invoices', 'select=*&order=nummer.desc&limit=500'),
      Auth.select('shop_orders', 'select=*&order=created_at.desc&limit=300'),
      Auth.select('shop_customers', 'select=*&order=name'),
    ]);
    D.articles = a; D.invoices = i; D.orders = o; D.customers = c;
  }

  async function render(el) {
    host = el;
    host.innerHTML = '<section class="panel empty"><p class="sub">Lade Shop …</p></section>';
    try { await loadAll(); } catch (e) {
      host.innerHTML = `<section class="panel empty"><h2>Shop nicht erreichbar</h2><p class="sub">${esc(friendlyAuthError(e))}</p><p class="hint">Falls die Shop-Tabellen noch fehlen: supabase/shop.sql im SQL-Editor ausführen.</p></section>`;
      return;
    }
    draw();
  }

  function draw() {
    const views = [['bestand', 'Bestand'], ['eingang', 'Wareneingang'], ['rechnungen', 'Rechnungen'], ['auftraege', 'Aufträge']];
    host.innerHTML = `<div class="seg-switch shop-nav" role="group">${views.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === view}">${l}</button>`).join('')}</div><div id="shop-body"></div>`;
    host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; draw(); }));
    ({ bestand: drawBestand, eingang: drawEingang, rechnungen: drawRechnungen, auftraege: drawAuftraege })[view]($('shop-body'));
  }

  // ---------- Dialog ----------
  function dialog(title, bodyHtml, wide) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="card${wide ? ' wide' : ''}" role="dialog" aria-modal="true"><div class="panel-head"><h2>${title}</h2><button type="button" class="icon-btn" data-close aria-label="Schließen">✕</button></div>${bodyHtml}</div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.querySelector('[data-close]').addEventListener('click', close);
    return { el: bg.querySelector('.card'), close };
  }
  const field = (label, name, value, type, extra) => `<label class="field">${label}<input name="${name}" type="${type || 'text'}" value="${esc(value === undefined || value === null ? '' : value)}" ${extra || ''}></label>`;

  // ---------- Bestand ----------
  function drawBestand(el) {
    const st = drawBestand.st = drawBestand.st || { q: '' };
    const list = D.articles.filter(a => !st.q || (a.name + ' ' + (a.artnr || '') + ' ' + (a.ean || '') + ' ' + (a.kategorie || '')).toLowerCase().includes(st.q.toLowerCase()));
    const wert = D.articles.reduce((s, a) => s + Math.max(0, a.bestand) * a.ek, 0);
    const knapp = D.articles.filter(a => a.aktiv && a.mindestbestand > 0 && a.bestand <= a.mindestbestand).length;
    el.innerHTML = `<section class="tiles tiles-3">
        <article class="tile"><div class="label">Artikel</div><div class="value num">${D.articles.filter(a => a.aktiv).length}</div></article>
        <article class="tile"><div class="label">Lagerwert (EK netto)</div><div class="value num">${eur(wert)}</div></article>
        <article class="tile"><div class="label">Unter Mindestbestand</div><div class="value num ${knapp ? 'neg' : ''}">${knapp}</div></article></section>
      <section class="panel"><div class="panel-head"><input id="s-q" class="search" placeholder="Suchen (Name, Art.-Nr., EAN)" value="${esc(st.q)}">
        <button class="btn" type="button" id="s-new">Artikel anlegen</button></div>
        <div class="tbl-wrap"><table class="shop"><thead><tr><th>Artikel</th><th>Art.-Nr.</th><th class="r">Bestand</th><th class="r">EK</th><th class="r">VK</th><th class="r">Lagerwert</th><th></th></tr></thead>
        <tbody>${list.map(a => `<tr class="${a.aktiv ? '' : 'muted'}"><td>${esc(a.name)}<div class="sub">${esc(a.kategorie || '')}</div></td><td class="sub">${esc(a.artnr || '')}</td>
          <td class="r num ${a.mindestbestand > 0 && a.bestand <= a.mindestbestand ? 'down' : ''}"><b>${de0.format(a.bestand)}</b></td><td class="r num">${m2(a.ek)}</td><td class="r num">${m2(a.vk)}</td><td class="r num">${m2(Math.max(0, a.bestand) * a.ek)}</td>
          <td class="r"><button class="btn ghost sm" data-edit="${a.id}">Bearbeiten</button> <button class="btn ghost sm" data-inv="${a.id}">Zählen</button></td></tr>`).join('') || '<tr><td colspan="7" class="sub">Noch keine Artikel. Lade unter „Wareneingang“ eine Lieferantenrechnung hoch oder lege Artikel an.</td></tr>'}</tbody></table></div></section>`;
    $('s-q').addEventListener('input', e => { st.q = e.target.value; const pos = e.target.selectionStart; drawBestand(el); const q = $('s-q'); q.focus(); q.setSelectionRange(pos, pos); });
    $('s-new').addEventListener('click', () => editArticle(null));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editArticle(D.articles.find(a => a.id === +b.dataset.edit))));
    el.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => inventur(D.articles.find(a => a.id === +b.dataset.inv))));
  }

  async function editArticle(a) {
    const d = dialog(a ? 'Artikel bearbeiten' : 'Artikel anlegen', `<form class="form-grid" novalidate>
      ${field('Bezeichnung', 'name', a && a.name)}${field('Kategorie', 'kategorie', a && a.kategorie)}
      ${field('Art.-Nr.', 'artnr', a && a.artnr)}${field('EAN', 'ean', a && a.ean)}
      ${field('EK netto (€ je Stück)', 'ek', a ? a.ek : 0, 'number', 'step="0.01"')}${field('VK brutto (€ je Stück)', 'vk', a ? a.vk : 0, 'number', 'step="0.01"')}
      ${field('USt-Satz %', 'ust', a ? a.ust : 19, 'number')}${field('Mindestbestand', 'mindestbestand', a ? a.mindestbestand : 0, 'number')}
      ${field('Stück je Liefereinheit', 'packung', a ? a.packung : 1, 'number')}
      ${a ? '' : field('Anfangsbestand (Stück)', 'start', 0, 'number')}
      <label class="field check"><input type="checkbox" name="aktiv" ${!a || a.aktiv ? 'checked' : ''}> aktiv</label>
      <p class="err" id="a-err"></p>
      <div class="actions"><button class="btn" type="submit">Speichern</button></div>
      ${a ? '<div class="span2" id="a-moves"><p class="sub">Lade Bewegungen …</p></div>' : ''}</form>`, true);
    const f = d.el.querySelector('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const row = { name: f.name.value.trim(), kategorie: f.kategorie.value.trim() || null, artnr: f.artnr.value.trim() || null, ean: f.ean.value.trim() || null,
        ek: +f.ek.value || 0, vk: +f.vk.value || 0, ust: +f.ust.value || 19, mindestbestand: +f.mindestbestand.value || 0, packung: +f.packung.value || 1, aktiv: f.aktiv.checked };
      if (!row.name) { $('a-err').textContent = 'Bitte eine Bezeichnung eingeben.'; return; }
      try {
        if (a) await Auth.update('shop_articles', 'id=eq.' + a.id, row);
        else {
          const n = await Auth.insert('shop_articles', row);
          const start = +f.start.value || 0;
          if (start) await Auth.insert('shop_movements', { article_id: n.id, menge: start, art: 'inventur', notiz: 'Anfangsbestand' });
        }
        d.close(); await loadAll(); draw(); toast('Gespeichert');
      } catch (x) { $('a-err').textContent = friendlyAuthError(x); }
    });
    if (a) {
      try {
        const mv = await Auth.select('shop_movements', `select=*&article_id=eq.${a.id}&order=created_at.desc&limit=25`);
        $('a-moves').innerHTML = `<h3>Letzte Bewegungen</h3><table class="shop"><tbody>${mv.map(m => `<tr><td>${deDate(m.datum)}</td><td>${esc(m.art)}</td><td class="sub">${esc(m.beleg || m.notiz || '')}</td><td class="r num ${m.menge < 0 ? 'down' : 'up'}">${m.menge > 0 ? '+' : ''}${de1.format(m.menge).replace(/,0$/, '')}</td></tr>`).join('') || '<tr><td class="sub">Noch keine.</td></tr>'}</tbody></table>`;
      } catch (x) { $('a-moves').textContent = ''; }
    }
  }

  function inventur(a) {
    const d = dialog('Bestand zählen', `<form class="form-grid" novalidate><p class="span2">${esc(a.name)} – im System: <b>${de0.format(a.bestand)}</b> Stück</p>
      ${field('Tatsächlich gezählt', 'ist', a.bestand, 'number')}${field('Notiz', 'notiz', 'Inventur')}
      <p class="err" id="i-err"></p><div class="actions"><button class="btn" type="submit">Bestand übernehmen</button></div></form>`);
    const f = d.el.querySelector('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const diff = (+f.ist.value || 0) - a.bestand;
      try {
        if (diff) await Auth.insert('shop_movements', { article_id: a.id, menge: diff, art: 'inventur', notiz: f.notiz.value || 'Inventur' });
        d.close(); await loadAll(); draw(); toast(diff ? `Bestand korrigiert (${diff > 0 ? '+' : ''}${diff})` : 'Bestand stimmt');
      } catch (x) { $('i-err').textContent = friendlyAuthError(x); }
    });
  }

  // ---------- Wareneingang ----------
  function drawEingang(el) {
    el.innerHTML = `<section class="panel"><div><h2>Lieferantenrechnung hochladen</h2>
      <p class="explain">PDF der Lieferantenrechnung auswählen (Tecnifibre wird automatisch gelesen). Du prüfst danach jede Position und bestätigst – erst dann wird der Bestand erhöht.</p></div>
      <div class="actions"><label class="btn" for="e-file">PDF auswählen</label><input type="file" id="e-file" accept="application/pdf,.pdf" hidden>
      <button class="btn ghost" type="button" id="e-manual">Ohne PDF erfassen</button></div><p class="err" id="e-err"></p></section>
      <section class="panel" id="e-review" hidden></section>`;
    $('e-file').addEventListener('change', async e => {
      const file = e.target.files[0]; e.target.value = '';
      if (!file) return;
      $('e-err').textContent = 'Lese Rechnung …';
      try {
        const r = await ShopParse.read(file);
        $('e-err').textContent = '';
        review(r, file);
      } catch (x) { $('e-err').textContent = x.message || String(x); }
    });
    $('e-manual').addEventListener('click', () => review({ lieferant: '', nummer: '', datum: todayIso(), total: null, items: [] }, null));
  }

  function matchArticle(it) {
    return D.articles.find(a => (it.artnr && a.artnr === it.artnr) || (it.ean && a.ean === it.ean)) || null;
  }

  async function review(r, file) {
    const box = $('e-review');
    let dup = false;
    if (r.lieferant && r.nummer) {
      try { dup = (await Auth.select('shop_docs', `select=id&lieferant=eq.${encodeURIComponent(r.lieferant)}&nummer=eq.${encodeURIComponent(r.nummer)}`)).length > 0; } catch (x) { /* egal */ }
    }
    const rows = r.items.map(it => {
      const a = it.lager === false ? null : matchArticle(it);
      return Object.assign({}, it, { aktion: it.lager === false ? 'skip' : a ? 'add' : 'neu', article_id: a ? a.id : null, faktor: a ? a.packung || 1 : 1 });
    });
    const paint = () => {
      box.hidden = false;
      box.innerHTML = `<div class="panel-head"><h2>Prüfen: ${esc(r.lieferant || 'Beleg')} ${esc(r.nummer || '')}</h2><span class="sub">${r.total !== null ? 'Rechnungssumme ' + m2(r.total) : ''}</span></div>
        ${dup ? '<p class="err">Achtung: Diese Rechnung wurde schon einmal gebucht.</p>' : ''}
        <div class="form-grid three">${field('Lieferant', 'lief', r.lieferant)}${field('Rechnungsnr.', 'rnr', r.nummer)}${field('Datum', 'rdat', r.datum, 'date')}</div>
        <div class="tbl-wrap"><table class="shop"><thead><tr><th>Position</th><th class="r">Menge</th><th class="r">Stück je Einheit</th><th class="r">= Stück</th><th class="r">EK/Stück</th><th>Buchung</th><th></th></tr></thead><tbody>
        ${rows.map((x, i) => `<tr data-i="${i}"><td><input class="cell" data-k="name" value="${esc(x.name)}"><div class="sub">${esc([x.artnr, x.ean && 'EAN ' + x.ean, x.kategorie].filter(Boolean).join(' · '))}${x.rabatt ? ' · −' + de0.format(x.rabatt) + ' %' : ''}</div></td>
          <td class="r"><input class="cell num-in" data-k="menge" type="number" value="${x.menge || 0}"></td>
          <td class="r"><input class="cell num-in" data-k="faktor" type="number" value="${x.faktor}"></td>
          <td class="r num"><b>${de0.format((x.menge || 0) * (x.faktor || 1))}</b></td>
          <td class="r num">${x.netto !== null && x.netto !== undefined ? m2((x.netto || 0) / (x.faktor || 1)) : '<input class="cell num-in" data-k="netto" type="number" step="0.01" value="">'}</td>
          <td><select class="cell" data-k="aktion">
            <option value="neu" ${x.aktion === 'neu' ? 'selected' : ''}>neuer Artikel</option>
            ${D.articles.map(a => `<option value="a${a.id}" ${x.aktion === 'add' && x.article_id === a.id ? 'selected' : ''}>→ ${esc(a.name)}</option>`).join('')}
            <option value="skip" ${x.aktion === 'skip' ? 'selected' : ''}>nicht einlagern (Eigenbedarf/Versand)</option></select></td>
          <td><button class="btn ghost sm" data-del="${i}">✕</button></td></tr>`).join('')}
        </tbody></table></div>
        <div class="actions"><button class="btn ghost" type="button" id="e-add">Position hinzufügen</button>
          <button class="btn" type="button" id="e-ok" ${rows.some(x => x.aktion !== 'skip') ? '' : 'disabled'}>Wareneingang buchen</button></div><p class="err" id="e-err2"></p>`;
      box.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.closest('tr').dataset.i, k = e.target.dataset.k, v = e.target.value;
        if (k === 'aktion') {
          if (v === 'neu' || v === 'skip') { rows[i].aktion = v; rows[i].article_id = null; }
          else { rows[i].aktion = 'add'; rows[i].article_id = +v.slice(1); rows[i].faktor = (D.articles.find(a => a.id === rows[i].article_id) || {}).packung || rows[i].faktor; }
        } else rows[i][k] = k === 'name' ? v : +v;
        paint();
      }));
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { rows.splice(+b.dataset.del, 1); paint(); }));
      $('e-add').addEventListener('click', () => { rows.push({ name: '', artnr: '', ean: '', kategorie: '', menge: 1, faktor: 1, netto: 0, betrag: 0, aktion: 'neu', article_id: null, lager: true }); paint(); });
      $('e-ok').addEventListener('click', () => buchen(r, rows, file, box));
    };
    paint();
  }

  async function buchen(r, rows, file, box) {
    const lief = box.querySelector('[name=lief]').value.trim() || 'Unbekannt';
    const rnr = box.querySelector('[name=rnr]').value.trim() || ('ohne-' + Date.now());
    const rdat = box.querySelector('[name=rdat]').value || todayIso();
    const err = $('e-err2'), btn = $('e-ok');
    if (rows.some(x => x.aktion !== 'skip' && !x.name)) { err.textContent = 'Bitte jeder Position eine Bezeichnung geben.'; return; }
    btn.disabled = true; btn.textContent = 'Buche …';
    try {
      let path = null;
      if (file) {
        path = `wareneingang/${lief.replace(/[^\w-]+/g, '_')}/${rnr.replace(/[^\w-]+/g, '_')}-${Date.now()}.pdf`;
        await Auth.upload('shop-docs', path, file);
      }
      await Auth.insert('shop_docs', { lieferant: lief, nummer: rnr, datum: rdat, summe: r.total, file_path: path }).catch(e => { if (!/duplicate|unique/i.test(e.message)) throw e; });
      let n = 0;
      for (const x of rows) {
        if (x.aktion === 'skip') continue;
        const stueck = (x.menge || 0) * (x.faktor || 1);
        const ekStueck = x.netto !== null && x.netto !== undefined ? r2((x.netto || 0) / (x.faktor || 1)) : 0;
        let id = x.article_id;
        if (x.aktion === 'neu') {
          const a = await Auth.insert('shop_articles', { name: x.name, artnr: x.artnr || null, ean: x.ean || null, kategorie: x.kategorie || null, ek: ekStueck, vk: 0, packung: x.faktor || 1 });
          id = a.id;
        } else if (ekStueck) {
          await Auth.update('shop_articles', 'id=eq.' + id, { ek: ekStueck, packung: x.faktor || 1 });
        }
        if (stueck) await Auth.insert('shop_movements', { article_id: id, menge: stueck, art: 'wareneingang', beleg: `${lief} ${rnr}`, datum: rdat });
        n++;
      }
      await loadAll();
      view = 'bestand'; draw();
      toast(`${n} Positionen eingebucht`);
    } catch (x) {
      err.textContent = friendlyAuthError(x); btn.disabled = false; btn.textContent = 'Wareneingang buchen';
    }
  }

  // ---------- Rechnungen ----------
  function drawRechnungen(el) {
    const st = drawRechnungen.st = drawRechnungen.st || { monat: todayIso().slice(0, 7) };
    const storniert = new Set(D.invoices.filter(i => i.storno_von).map(i => i.storno_von));
    const offen = D.invoices.filter(i => !i.bezahlt && !i.storno_von && !storniert.has(i.nummer));
    el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Rechnungen</h2><p class="explain">Nummern laufen lückenlos weiter (zuletzt ${D.invoices[0] ? nr(D.invoices[0].nummer) : 'S 398 aus DreamRobot'}). Erstellte Rechnungen sind nicht mehr änderbar – Korrektur per Storno.</p></div>
        <div class="actions"><button class="btn" type="button" id="r-new">Neue Rechnung</button></div></div>
        ${offen.length ? `<p class="sub">Offen: ${offen.length} Rechnungen, zusammen ${m2(offen.reduce((s, i) => s + +i.brutto, 0))}</p>` : ''}
        <div class="tbl-wrap"><table class="shop"><thead><tr><th>Nr.</th><th>Datum</th><th>Kunde</th><th class="r">Brutto</th><th>Bezahlt</th><th></th></tr></thead><tbody>
        ${D.invoices.map(i => `<tr class="${storniert.has(i.nummer) || i.storno_von ? 'muted' : ''}"><td><b>${nr(i.nummer)}</b>${i.storno_von ? `<div class="sub">Storno zu ${nr(i.storno_von)}</div>` : storniert.has(i.nummer) ? '<div class="sub">storniert</div>' : ''}</td>
          <td>${deDate(i.datum)}</td><td>${esc(i.kunde.firma || i.kunde.name || '')}</td><td class="r num">${m2(+i.brutto)}</td>
          <td>${i.storno_von ? '' : `<input type="checkbox" data-paid="${i.id}" ${i.bezahlt ? 'checked' : ''}>`}</td>
          <td class="r"><button class="btn ghost sm" data-pdf="${i.id}">PDF</button>${!i.storno_von && !storniert.has(i.nummer) ? ` <button class="btn ghost sm" data-storno="${i.id}">Storno</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="sub">Noch keine Rechnungen.</td></tr>'}
        </tbody></table></div></section>
      <section class="panel"><div class="panel-head"><div><h2>Export für Steuerberater / Lexoffice</h2><p class="explain">Rechnungsliste (CSV) und alle PDFs eines Monats als ZIP.</p></div>
        <div class="actions"><input type="month" id="r-mon" value="${st.monat}"><button class="btn ghost" type="button" id="r-exp">Herunterladen</button></div></div><p class="err" id="r-err"></p></section>`;
    $('r-new').addEventListener('click', () => invoiceForm({}));
    $('r-mon').addEventListener('change', e => { st.monat = e.target.value; });
    $('r-exp').addEventListener('click', () => exportMonat(st.monat));
    el.querySelectorAll('[data-paid]').forEach(c => c.addEventListener('change', async e => {
      try { await Auth.rpc('shop_invoice_paid', { p_id: +e.target.dataset.paid, p_paid: e.target.checked }); const inv = D.invoices.find(i => i.id === +e.target.dataset.paid); inv.bezahlt = e.target.checked; toast(e.target.checked ? 'Als bezahlt markiert' : 'Als offen markiert'); }
      catch (x) { toast(friendlyAuthError(x)); e.target.checked = !e.target.checked; }
    }));
    el.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => openInvoicePdf(D.invoices.find(i => i.id === +b.dataset.pdf))));
    el.querySelectorAll('[data-storno]').forEach(b => b.addEventListener('click', () => storno(D.invoices.find(i => i.id === +b.dataset.storno))));
  }

  // Neue Rechnung (optional aus einem Auftrag vorbelegt)
  function invoiceForm(pre) {
    const kunde = Object.assign({ name: '', firma: '', strasse: '', plz_ort: '', email: '', ustid: '' }, pre.kunde || {});
    const pos = (pre.positionen || []).map(p => Object.assign({}, p));
    if (!pos.length) pos.push({ article_id: null, text: '', menge: 1, preis: 0, ust: 19 });
    const d = dialog('Neue Rechnung', `<form novalidate><datalist id="dl-art">${D.articles.filter(a => a.aktiv).map(a => `<option value="${esc(a.name)}">`).join('')}</datalist>
      <datalist id="dl-kd">${D.customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <h3>Kunde</h3><div class="form-grid">${field('Name', 'k_name', kunde.name, 'text', 'list="dl-kd"')}${field('Firma (optional)', 'k_firma', kunde.firma)}
      ${field('Straße', 'k_strasse', kunde.strasse)}${field('PLZ Ort', 'k_plz_ort', kunde.plz_ort)}${field('E-Mail (optional)', 'k_email', kunde.email)}${field('USt-IdNr. (nur Firmen)', 'k_ustid', kunde.ustid)}
      <label class="field check"><input type="checkbox" name="k_save" ${kunde.id ? '' : 'checked'}> Kunde speichern</label></div>
      <h3>Positionen <span class="sub">(Preise brutto)</span></h3><div id="f-pos"></div>
      <div class="actions"><button class="btn ghost sm" type="button" id="f-add">Position</button><button class="btn ghost sm" type="button" id="f-rab">Rabatt</button></div>
      <div class="form-grid">${field('Rechnungsdatum', 'datum', todayIso(), 'date')}${field('Leistungsdatum', 'ldatum', todayIso(), 'date')}</div>
      <div id="f-sum" class="inv-sum"></div><p class="err" id="f-err"></p>
      <div class="actions"><button class="btn" type="button" id="f-lex">Als Lexoffice-Entwurf anlegen</button><button class="btn ghost" type="submit" id="f-ok">Rechnung im Cockpit erstellen</button></div>
      <p class="hint">Lexoffice-Entwurf: Die Rechnung erscheint in Lexoffice unter Rechnungen → Entwürfe. Dort prüfen, abschließen und versenden – erst dann ist sie gültig. Der Bestand wird beim Anlegen des Entwurfs abgebucht.</p></form>`, true);
    const f = d.el.querySelector('form');
    f.k_name.addEventListener('change', () => {
      const c = D.customers.find(x => x.name === f.k_name.value);
      if (!c) return;
      kunde.id = c.id; ['firma', 'strasse', 'plz_ort', 'email', 'ustid'].forEach(k => { f['k_' + k].value = c[k] || ''; });
      f.k_save.checked = false;
    });
    const sums = () => {
      const by = {};
      pos.forEach(p => { const b = r2((+p.menge || 0) * (+p.preis || 0)); by[p.ust] = (by[p.ust] || 0) + b; });
      const brutto = Object.values(by).reduce((s, v) => s + v, 0);
      $('f-sum').innerHTML = Object.keys(by).map(k => `<div><span>Netto (${k} %)</span><span>${m2(r2(by[k] / (1 + k / 100)))}</span></div><div><span>enthaltene MwSt. ${k} %</span><span>${m2(by[k] - r2(by[k] / (1 + k / 100)))}</span></div>`).join('') +
        `<div class="tot"><span>Gesamtbetrag (brutto)</span><span>${m2(brutto)}</span></div>`;
      return brutto;
    };
    const paintPos = () => {
      $('f-pos').innerHTML = pos.map((p, i) => {
        const a = p.article_id ? D.articles.find(x => x.id === p.article_id) : null;
        const warn = a && a.bestand < p.menge ? `<span class="down sub">nur ${de0.format(a.bestand)} auf Lager</span>` : '';
        return `<div class="pos-row" data-i="${i}"><input class="cell" data-k="text" list="dl-art" placeholder="Artikel oder freier Text" value="${esc(p.text)}">
          <input class="cell num-in" data-k="menge" type="number" value="${p.menge}" title="Menge"><input class="cell num-in" data-k="preis" type="number" step="0.01" value="${p.preis}" title="Einzelpreis brutto">
          <select class="cell" data-k="ust"><option value="19" ${+p.ust === 19 ? 'selected' : ''}>19 %</option><option value="7" ${+p.ust === 7 ? 'selected' : ''}>7 %</option></select>
          <span class="num">${m2(r2((+p.menge || 0) * (+p.preis || 0)))}</span><button type="button" class="btn ghost sm" data-del="${i}">✕</button>${warn}</div>`;
      }).join('');
      $('f-pos').querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.closest('.pos-row').dataset.i, k = e.target.dataset.k, v = e.target.value;
        if (k === 'text') {
          pos[i].text = v;
          const a = D.articles.find(x => x.name === v);
          pos[i].article_id = a ? a.id : null;
          if (a) { pos[i].preis = a.vk; pos[i].ust = a.ust; }
        } else pos[i][k] = +v;
        paintPos();
      }));
      $('f-pos').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { pos.splice(+b.dataset.del, 1); paintPos(); }));
      sums();
    };
    $('f-add').addEventListener('click', () => { pos.push({ article_id: null, text: '', menge: 1, preis: 0, ust: 19 }); paintPos(); });
    $('f-rab').addEventListener('click', () => { pos.push({ article_id: null, text: 'Rabatt', menge: 1, preis: -5, ust: 19 }); paintPos(); });
    paintPos();
    let armed = false;
    $('f-lex').addEventListener('click', async () => {
      const err = $('f-err'), btn = $('f-lex');
      const k = { name: f.k_name.value.trim(), firma: f.k_firma.value.trim(), strasse: f.k_strasse.value.trim(), plz_ort: f.k_plz_ort.value.trim(), email: f.k_email.value.trim(), ustid: f.k_ustid.value.trim() };
      const p = pos.filter(x => x.text && +x.menge);
      if (!k.name && !k.firma) { err.textContent = 'Bitte Kundenname eingeben.'; return; }
      if (!p.length) { err.textContent = 'Bitte mindestens eine Position mit Text und Menge.'; return; }
      if (sums() <= 0) { err.textContent = 'Der Gesamtbetrag muss größer als 0 sein.'; return; }
      btn.disabled = true; btn.textContent = 'Lege Entwurf an …'; err.textContent = '';
      try {
        if (f.k_save.checked) await Auth.insert('shop_customers', k);
        const positionen = p.map(x => ({ article_id: x.article_id, artnr: ((D.articles.find(a => a.id === x.article_id) || {}).artnr) || '', text: x.text, menge: +x.menge, preis: +x.preis, ust: +x.ust }));
        const res = await fetch((window.SK_CONFIG || {}).live, { method: 'POST', body: JSON.stringify({ token: await Auth.token(), action: 'lexDraft', co: 'tennis', invoice: { kunde: k, positionen, datum: f.datum.value, leistungsdatum: f.ldatum.value } }) });
        const r = await res.json();
        if (!r.ok) throw new Error(r.error === 'forbidden' ? 'Nur für den Admin-Zugang.' : (r.error || 'Lexoffice hat nicht geantwortet.'));
        for (const x of positionen) if (x.article_id) await Auth.insert('shop_movements', { article_id: x.article_id, menge: -x.menge, art: 'verkauf', beleg: 'Lexoffice-Entwurf', datum: f.datum.value, notiz: k.firma || k.name });
        if (pre.orderId) await Auth.update('shop_orders', 'id=eq.' + pre.orderId, { status: 'abgerechnet', notiz: 'Lexoffice-Entwurf angelegt', updated_at: new Date().toISOString() });
        d.close(); await loadAll(); draw();
        toast('Entwurf in Lexoffice angelegt – dort unter Rechnungen → Entwürfe abschließen');
      } catch (x) { err.textContent = x.message || String(x); btn.disabled = false; btn.textContent = 'Als Lexoffice-Entwurf anlegen'; }
    });
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const err = $('f-err'), btn = $('f-ok');
      const k = { name: f.k_name.value.trim(), firma: f.k_firma.value.trim(), strasse: f.k_strasse.value.trim(), plz_ort: f.k_plz_ort.value.trim(), email: f.k_email.value.trim(), ustid: f.k_ustid.value.trim() };
      const p = pos.filter(x => x.text && +x.menge);
      if (!k.name && !k.firma) { err.textContent = 'Bitte Kundenname eingeben.'; return; }
      if (!p.length) { err.textContent = 'Bitte mindestens eine Position mit Text und Menge.'; return; }
      if (sums() <= 0) { err.textContent = 'Der Gesamtbetrag muss größer als 0 sein.'; return; }
      if (!armed) { armed = true; btn.textContent = 'Wirklich erstellen? Danach nicht mehr änderbar'; btn.classList.add('warn-btn'); return; }
      btn.disabled = true; btn.textContent = 'Erstelle …';
      try {
        if (f.k_save.checked) { const c = await Auth.insert('shop_customers', k); k.kundennr = c.id; } else if (kunde.id) k.kundennr = kunde.id;
        const inv = await createInvoice(k, p.map(x => ({ article_id: x.article_id, text: x.text, menge: +x.menge, preis: +x.preis, ust: +x.ust })), f.datum.value, f.ldatum.value, null);
        if (pre.orderId) await Auth.update('shop_orders', 'id=eq.' + pre.orderId, { status: 'abgerechnet', invoice_nummer: inv.nummer, updated_at: new Date().toISOString() });
        d.close(); await loadAll(); view = 'rechnungen'; draw();
        toast(`Rechnung ${nr(inv.nummer)} erstellt`);
        openInvoicePdf(D.invoices.find(i => i.id === inv.id) || inv);
      } catch (x) { err.textContent = friendlyAuthError(x); btn.disabled = false; btn.textContent = 'Rechnung im Cockpit erstellen'; armed = false; btn.classList.remove('warn-btn'); }
    });
  }

  async function createInvoice(kunde, positionen, datum, ldatum, stornoVon) {
    const inv = await Auth.rpc('shop_create_invoice', { p_kunde: kunde, p_positionen: positionen, p_datum: datum, p_leistungsdatum: ldatum || datum, p_storno_von: stornoVon });
    // Die Rechnung existiert ab hier; scheitert das PDF, wird es beim Öffnen aus den gespeicherten Daten neu erzeugt
    const path = `rechnungen/${inv.datum.slice(0, 4)}/S${inv.nummer}.pdf`;
    try { await Auth.upload('shop-docs', path, await invoicePdf(inv)); await Auth.rpc('shop_invoice_file', { p_id: inv.id, p_path: path }); inv.file_path = path; }
    catch (x) { console.warn('PDF nicht abgelegt', x); }
    return inv;
  }

  async function storno(inv) {
    const d = dialog('Rechnung stornieren', `<p>Für <b>${nr(inv.nummer)}</b> (${esc(inv.kunde.firma || inv.kunde.name)}, ${m2(+inv.brutto)}) wird eine Stornorechnung mit neuer Nummer erstellt. Artikel werden zurück ins Lager gebucht.</p>
      <p class="err" id="s-err"></p><div class="actions"><button class="btn" type="button" id="s-ok">Stornorechnung erstellen</button></div>`);
    $('s-ok').addEventListener('click', async () => {
      $('s-ok').disabled = true;
      try {
        const neg = inv.positionen.map(p => Object.assign({}, p, { menge: -p.menge }));
        const s = await createInvoice(inv.kunde, neg, todayIso(), inv.leistungsdatum, inv.nummer);
        d.close(); await loadAll(); draw(); toast(`Stornorechnung ${nr(s.nummer)} erstellt`);
      } catch (x) { $('s-err').textContent = friendlyAuthError(x); $('s-ok').disabled = false; }
    });
  }

  async function openInvoicePdf(inv) {
    const w = window.open('', '_blank');
    try {
      let url;
      if (inv.file_path) url = await Auth.signedUrl('shop-docs', inv.file_path);
      else url = URL.createObjectURL(await invoicePdf(inv)); // Fallback: aus den gespeicherten Daten neu zeichnen
      if (w) w.location = url; else location.href = url;
    } catch (x) { if (w) w.close(); toast('PDF konnte nicht geöffnet werden'); }
  }

  // ---------- PDF ----------
  let libs = null;
  function loadLibs() {
    const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Bibliothek nicht geladen')); document.head.appendChild(s); });
    if (!libs) libs = Promise.all([
      window.jspdf ? null : load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'),
      window.JSZip ? null : load('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
    ]).catch(e => { libs = null; throw e; });
    return libs;
  }
  // Logo (heller Schriftzug) dunkel einfärben, damit es auf weißem Papier sichtbar ist
  let logoData = null;
  async function logo() {
    if (logoData) return logoData;
    const img = new Image();
    await new Promise((res, rej) => { // decode() hängt in manchen Browsern, daher onload + Zeitlimit
      img.onload = res; img.onerror = () => rej(new Error('Logo fehlt'));
      setTimeout(() => rej(new Error('Logo lädt nicht')), 5000);
      img.src = 'icons/logo-tennis.png';
    });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = '#1f2433'; g.fillRect(0, 0, c.width, c.height);
    logoData = { data: c.toDataURL('image/png'), ratio: c.height / c.width };
    return logoData;
  }

  async function invoicePdf(inv) {
    await loadLibs();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const L = 20, R = 190;
    const money = v => (v < 0 ? '-' : '') + de2.format(Math.abs(v)) + ' EUR';
    try { const lg = await logo(); doc.addImage(lg.data, 'PNG', L, 18, 85, 85 * lg.ratio); } catch (x) { doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text('SK TENNIS BASE', L, 25); }
    const storno = !!inv.storno_von;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(storno ? 'Stornorechnung' : 'Rechnung', R, 22, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    const meta = [['Rechnungsnr.:', nr(inv.nummer)]];
    if (inv.kunde.kundennr) meta.push(['Kundennr.:', String(inv.kunde.kundennr)]);
    meta.push(['Rechnungsdatum:', deDate(inv.datum)], ['Leistungsdatum:', deDate(inv.leistungsdatum || inv.datum)]);
    if (storno) meta.push(['Storno zu:', nr(inv.storno_von)]);
    meta.forEach(([a, b], i) => { doc.text(a, R - 32, 30 + i * 5, { align: 'right' }); doc.text(b, R, 30 + i * 5, { align: 'right' }); });
    // Absender + Empfänger
    doc.setFontSize(7.5); doc.text(`${FIRMA.name} · ${FIRMA.strasse} · ${FIRMA.ort}`, L, 48);
    doc.setFontSize(10);
    const k = inv.kunde, adr = [k.firma, k.name, k.strasse, k.plz_ort].filter(Boolean);
    if (k.ustid) adr.push('USt-IdNr.: ' + k.ustid);
    adr.forEach((t, i) => doc.text(String(t), L, 55 + i * 5));
    doc.setFontSize(8.5);
    [FIRMA.name, FIRMA.strasse, FIRMA.ort, 'Tel: ' + FIRMA.tel, FIRMA.mail, FIRMA.web].forEach((t, i) => doc.text(t, R, 55 + i * 4, { align: 'right' }));
    // Positionen
    let y = 92;
    doc.setFillColor(225, 225, 225); doc.rect(L, y - 5, R - L, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    doc.text('Nr.', L + 2, y); doc.text('Menge', L + 12, y); doc.text('Bezeichnung', L + 30, y); doc.text('Einzelpreis', R - 32, y, { align: 'right' }); doc.text('Gesamtbetrag', R - 2, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    y += 8;
    inv.positionen.forEach((p, i) => {
      const txt = doc.splitTextToSize(String(p.text), R - 32 - 30 - L - 22);
      if (y + txt.length * 4.5 > 245) { doc.addPage(); y = 25; }
      doc.text(String(i + 1), L + 2, y); doc.text(de2.format(p.menge).replace(/,00$/, ''), L + 12, y); doc.text(txt, L + 30, y);
      doc.text(money(p.preis), R - 32, y, { align: 'right' }); doc.text(money(r2(p.menge * p.preis)), R - 2, y, { align: 'right' });
      y += Math.max(1, txt.length) * 4.5 + 1.5;
    });
    doc.setDrawColor(150); doc.line(L, y, R, y); y += 6;
    // Summen je Steuersatz
    const st = inv.steuer || {};
    Object.keys(st).sort().forEach(s => {
      doc.text(`Nettobetrag (${s} %):`, R - 32, y, { align: 'right' }); doc.text(money(+st[s].netto), R - 2, y, { align: 'right' }); y += 5;
      doc.text(`enthaltene MwSt. (${s} %):`, R - 32, y, { align: 'right' }); doc.text(money(+st[s].ust), R - 2, y, { align: 'right' }); y += 5;
    });
    doc.setFont('helvetica', 'bold'); doc.text('Gesamtbetrag (brutto):', R - 32, y + 1, { align: 'right' }); doc.text(money(+inv.brutto), R - 2, y + 1, { align: 'right' });
    doc.setFont('helvetica', 'normal'); y += 12;
    doc.setFontSize(9.5);
    if (storno) doc.text(`Diese Stornorechnung hebt die Rechnung ${nr(inv.storno_von)} auf.`, L, y);
    else doc.text(FIRMA.zahlung, L, y);
    // Fußzeile mit Pflichtangaben
    doc.setFontSize(8); doc.setTextColor(80);
    const foot = [`${FIRMA.name} · ${FIRMA.strasse} · ${FIRMA.ort} · Geschäftsführer: ${FIRMA.gf}`,
      `Steuernummer: ${FIRMA.steuernr} · USt-IdNr.: ${FIRMA.ustid} · ${FIRMA.register}`,
      `${FIRMA.bank} · IBAN: ${FIRMA.iban} · BIC: ${FIRMA.bic}`];
    const pages = doc.getNumberOfPages();
    for (let pg = 1; pg <= pages; pg++) { doc.setPage(pg); foot.forEach((t, i) => doc.text(t, 105, 275 + i * 4, { align: 'center' })); doc.text(`Seite ${pg} von ${pages}`, R, 290, { align: 'right' }); }
    return doc.output('blob');
  }

  async function exportMonat(monat) {
    const err = $('r-err'); err.textContent = 'Erstelle Export …';
    try {
      await loadLibs();
      const list = D.invoices.filter(i => i.datum.slice(0, 7) === monat).sort((a, b) => a.nummer - b.nummer);
      if (!list.length) { err.textContent = 'In diesem Monat gibt es keine Rechnungen.'; return; }
      const csv = ['Rechnungsnr;Datum;Leistungsdatum;Kunde;Netto;USt;Brutto;Storno zu;Bezahlt'].concat(list.map(i =>
        [nr(i.nummer), deDate(i.datum), deDate(i.leistungsdatum), (i.kunde.firma || i.kunde.name || '').replace(/;/g, ','), de2.format(+i.netto), de2.format(+i.ust), de2.format(+i.brutto), i.storno_von ? nr(i.storno_von) : '', i.bezahlt ? 'ja' : 'nein'].join(';'))).join('\r\n');
      const zip = new JSZip();
      zip.file(`Rechnungen_${monat}.csv`, '﻿' + csv);
      for (const i of list) {
        const blob = i.file_path ? await (await fetch(await Auth.signedUrl('shop-docs', i.file_path))).blob() : await invoicePdf(i);
        zip.file(`S${i.nummer}.pdf`, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(out); a.download = `SK-Shop-Rechnungen_${monat}.zip`; document.body.appendChild(a); a.click(); a.remove();
      err.textContent = `${list.length} Rechnungen exportiert.`;
    } catch (x) { err.textContent = friendlyAuthError(x); }
  }

  // ---------- Aufträge ----------
  const STATUS = ['offen', 'bestellt', 'geliefert', 'abgerechnet', 'storniert'];
  function drawAuftraege(el) {
    const st = drawAuftraege.st = drawAuftraege.st || { alle: false };
    const list = D.orders.filter(o => st.alle || !['abgerechnet', 'storniert'].includes(o.status));
    el.innerHTML = `<section class="panel"><div class="panel-head"><div><h2>Kundenaufträge</h2><p class="explain">Z. B. Schläger- oder Textilbestellungen für Kunden. Aus einem Auftrag wird mit einem Klick die Rechnung.</p></div>
      <div class="actions"><label class="sub"><input type="checkbox" id="o-all" ${st.alle ? 'checked' : ''}> auch erledigte</label><button class="btn" type="button" id="o-new">Neuer Auftrag</button></div></div>
      <div class="tbl-wrap"><table class="shop"><thead><tr><th>Datum</th><th>Kunde</th><th>Positionen</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(o => `<tr><td>${deDate(o.created_at.slice(0, 10))}</td><td>${esc(o.kunde.firma || o.kunde.name || '')}${o.notiz ? `<div class="sub">${esc(o.notiz)}</div>` : ''}</td>
        <td class="sub">${o.positionen.map(p => `${p.menge}× ${esc(p.text)}`).join('<br>')}</td>
        <td>${o.status === 'abgerechnet' ? `abgerechnet${o.invoice_nummer ? ' (' + nr(o.invoice_nummer) + ')' : ''}` : `<select data-st="${o.id}">${STATUS.filter(s => s !== 'abgerechnet').map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`}</td>
        <td class="r">${o.status !== 'abgerechnet' && o.status !== 'storniert' ? `<button class="btn ghost sm" data-inv="${o.id}">Rechnung erstellen</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="sub">Keine offenen Aufträge.</td></tr>'}
      </tbody></table></div></section>`;
    $('o-all').addEventListener('change', e => { st.alle = e.target.checked; drawAuftraege(el); });
    $('o-new').addEventListener('click', orderForm);
    el.querySelectorAll('[data-st]').forEach(s => s.addEventListener('change', async e => {
      try { await Auth.update('shop_orders', 'id=eq.' + e.target.dataset.st, { status: e.target.value, updated_at: new Date().toISOString() }); await loadAll(); toast('Status geändert'); }
      catch (x) { toast(friendlyAuthError(x)); }
    }));
    el.querySelectorAll('[data-inv]').forEach(b => b.addEventListener('click', () => {
      const o = D.orders.find(x => x.id === +b.dataset.inv);
      invoiceForm({ kunde: o.kunde, positionen: o.positionen, orderId: o.id });
    }));
  }

  function orderForm() {
    const pos = [{ article_id: null, text: '', menge: 1, preis: 0, ust: 19 }];
    const d = dialog('Neuer Auftrag', `<form novalidate><datalist id="dl-art2">${D.articles.filter(a => a.aktiv).map(a => `<option value="${esc(a.name)}">`).join('')}</datalist>
      <datalist id="dl-kd2">${D.customers.map(c => `<option value="${esc(c.name)}">`).join('')}</datalist>
      <div class="form-grid">${field('Kunde', 'k_name', '', 'text', 'list="dl-kd2"')}${field('Firma (optional)', 'k_firma', '')}${field('Straße', 'k_strasse', '')}${field('PLZ Ort', 'k_plz_ort', '')}</div>
      <h3>Positionen <span class="sub">(Preise brutto)</span></h3><div id="o-pos"></div><button class="btn ghost sm" type="button" id="o-add">Position</button>
      ${field('Notiz', 'notiz', '')}<p class="err" id="o-err"></p><div class="actions"><button class="btn" type="submit">Auftrag speichern</button></div></form>`, true);
    const f = d.el.querySelector('form');
    f.k_name.addEventListener('change', () => { const c = D.customers.find(x => x.name === f.k_name.value); if (c) { f.k_firma.value = c.firma || ''; f.k_strasse.value = c.strasse || ''; f.k_plz_ort.value = c.plz_ort || ''; } });
    const paint = () => {
      $('o-pos').innerHTML = pos.map((p, i) => `<div class="pos-row" data-i="${i}"><input class="cell" data-k="text" list="dl-art2" placeholder="Artikel oder freier Text" value="${esc(p.text)}">
        <input class="cell num-in" data-k="menge" type="number" value="${p.menge}"><input class="cell num-in" data-k="preis" type="number" step="0.01" value="${p.preis}"><button type="button" class="btn ghost sm" data-del="${i}">✕</button></div>`).join('');
      $('o-pos').querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', e => {
        const i = +e.target.closest('.pos-row').dataset.i, k = e.target.dataset.k, v = e.target.value;
        if (k === 'text') { pos[i].text = v; const a = D.articles.find(x => x.name === v); pos[i].article_id = a ? a.id : null; if (a) { pos[i].preis = a.vk; pos[i].ust = a.ust; } }
        else pos[i][k] = +v;
        paint();
      }));
      $('o-pos').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { pos.splice(+b.dataset.del, 1); paint(); }));
    };
    $('o-add').addEventListener('click', () => { pos.push({ article_id: null, text: '', menge: 1, preis: 0, ust: 19 }); paint(); });
    paint();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const c = D.customers.find(x => x.name === f.k_name.value.trim());
      const kunde = { name: f.k_name.value.trim(), firma: f.k_firma.value.trim(), strasse: f.k_strasse.value.trim(), plz_ort: f.k_plz_ort.value.trim() };
      if (c) Object.assign(kunde, { id: c.id, kundennr: c.id, email: c.email || '', ustid: c.ustid || '' });
      const p = pos.filter(x => x.text && x.menge);
      if (!kunde.name) { $('o-err').textContent = 'Bitte Kunde eingeben.'; return; }
      if (!p.length) { $('o-err').textContent = 'Bitte mindestens eine Position.'; return; }
      try { await Auth.insert('shop_orders', { kunde, positionen: p, notiz: f.notiz.value.trim() || null }); d.close(); await loadAll(); view = 'auftraege'; draw(); toast('Auftrag gespeichert'); }
      catch (x) { $('o-err').textContent = friendlyAuthError(x); }
    });
  }

  return { render, invoicePdf };
})();
