'use strict';

/* ============================================================
   SK Cockpit: Anmeldung → Firma wählen → Finanz-Dashboard aus der BWA.
   ============================================================ */

// Bei jeder Änderung hochzählen – und gleich in version.json eintragen.
const APP_VERSION = '4';

const PREF_KEY = 'skcockpit:prefs';
const app = document.getElementById('app');
const fileInput = document.getElementById('file-input');
const dropHint = document.getElementById('drop-hint');

const state = {
  me: null,           // { name, role }
  companies: [],      // aus Tabelle companies
  docs: {},           // docs[company][year] = neueste BWA
  company: null,
  year: null,
  period: 'cum',
  loading: false,
};

/* ---------- Kleinigkeiten ---------- */
const $ = id => document.getElementById(id);
function prefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(prefs(), p))); } catch {} }
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
const ICON = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
};
const company = () => state.companies.find(c => c.id === state.company);
const years = id => Object.keys(state.docs[id] || {}).map(Number).sort((a, b) => b - a);

/* ---------- Anmeldung ---------- */
function renderLogin(msg) {
  app.innerHTML = `<div class="center"><form class="card" id="login" novalidate>
    <div class="brand"><div class="logo" aria-hidden="true">SK</div><div><h1>SK Cockpit</h1><div class="sub">Zahlen für Tennis Base und Fitness Base</div></div></div>
    <label class="field">E-Mail<input type="email" name="email" autocomplete="username" required></label>
    <label class="field">Passwort<input type="password" name="password" autocomplete="current-password" required></label>
    <p class="err" id="login-err">${esc(msg || '')}</p>
    <button class="btn wide" type="submit">Anmelden</button>
    <p class="hint">Zugänge gibt es nur auf Einladung. Passwort vergessen? Kurz beim Admin melden.</p>
  </form></div>`;
  const f = $('login');
  f.email.value = prefs().email || '';
  (f.email.value ? f.password : f.email).focus();
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = f.querySelector('button');
    if (!f.email.value || !f.password.value) { $('login-err').textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
    btn.disabled = true; btn.textContent = 'Melde an …';
    try {
      await Auth.signIn(f.email.value, f.password.value);
      savePrefs({ email: f.email.value.trim() });
      await boot();
    } catch (err) {
      $('login-err').textContent = friendlyAuthError(err);
      btn.disabled = false; btn.textContent = 'Anmelden';
    }
  });
}

function renderMessage(title, text, withLogout) {
  app.innerHTML = `<div class="center"><div class="card">
    <div class="brand"><div class="logo" aria-hidden="true">SK</div><h1>${esc(title)}</h1></div>
    <p>${text}</p>
    ${withLogout ? '<button class="btn ghost wide" id="out">Abmelden</button>' : ''}
  </div></div>`;
  if (withLogout) $('out').addEventListener('click', logout);
}

async function logout() {
  await Auth.signOut();
  state.me = null; state.docs = {}; state.company = null;
  Live.reset();
  renderLogin();
}

/* ---------- Daten laden ---------- */
async function loadAll() {
  const [me, companies, docs] = await Promise.all([
    Auth.select('members', `select=name,role&user_id=eq.${Auth.session.user.id}`),
    Auth.select('companies', 'select=*&order=sort'),
    Auth.select('bwa_latest', 'select=*&order=company,year.desc'),
  ]);
  state.me = me[0] || null;
  state.companies = companies;
  state.docs = {};
  for (const d of docs) (state.docs[d.company] = state.docs[d.company] || {})[d.year] = d;
}

async function boot() {
  if (!Auth.configured()) {
    renderMessage('Noch nicht eingerichtet', 'Die Verbindung zur Datenbank fehlt noch (config.js).');
    return;
  }
  if (!Auth.load()) { renderLogin(); return; }
  app.innerHTML = '<div class="center"><p class="sub">Lade Zahlen …</p></div>';
  try {
    await loadAll();
  } catch (e) {
    if (!Auth.session) { renderLogin('Bitte melde dich erneut an.'); return; }
    renderMessage('Keine Verbindung', esc(friendlyAuthError(e)) + ' <br><br><button class="btn" onclick="boot()">Erneut versuchen</button>', true);
    return;
  }
  if (!state.me) {
    renderMessage('Kein Zugriff', 'Dein Konto ist angemeldet, hat aber keinen Zugriff auf das Cockpit. Bitte beim Admin melden.', true);
    return;
  }
  const p = prefs();
  const known = state.companies.some(c => c.id === p.company);
  if (known && p.remember !== false) openCompany(p.company);
  else renderPicker();
}

/* ---------- Firmenauswahl ---------- */
function renderPicker() {
  state.company = null;
  savePrefs({ company: null });
  const cards = state.companies.map(c => {
    const y = years(c.id)[0];
    let body = '<p class="sub">Noch keine BWA hochgeladen.</p>';
    if (y) {
      const s = Fin.summary(state.docs[c.id][y]);
      body = `<div><div class="sub">Ergebnis ${esc(s.range)}</div>
        <div class="big num ${s.erg >= 0 ? 'pos' : 'neg'}">${eurS(s.erg)}</div></div>
        <div class="sub">${esc(s.lastName)}: <b class="${s.last >= 0 ? 'up' : 'down'}">${eurS(s.last)}</b> · Einnahmen ${eur(s.ein)}</div>`;
    }
    return `<button class="co-card" style="--k: ${esc(c.color)}" data-co="${esc(c.id)}">
      <div class="brand"><div class="logo" style="background:${esc(c.color)}" aria-hidden="true">SK</div><h2>${esc(c.short)}</h2></div>
      ${body}
    </button>`;
  }).join('');
  app.innerHTML = `${appbar(false)}<main class="picker">
    <div><h1>Hallo ${esc(state.me.name.split(' ')[0])}</h1><p class="sub">Welche Firma möchtest du ansehen?</p></div>
    <div class="picker-grid">${cards}</div>
  </main>`;
  app.querySelectorAll('[data-co]').forEach(b => b.addEventListener('click', () => openCompany(b.dataset.co)));
  bindAppbar();
}

function appbar(withSwitch) {
  const sw = withSwitch ? `<div class="seg-switch" role="group" aria-label="Firma">${state.companies.map(c =>
    `<button data-switch="${esc(c.id)}" aria-pressed="${c.id === state.company}">${esc(c.short)}</button>`).join('')}</div>` : '';
  return `<div class="appbar"><div class="appbar-in">
    <span class="name">SK Cockpit</span>${sw}
    ${withSwitch ? `<button class="icon-btn" id="to-picker" aria-label="Firmenübersicht" title="Firmenübersicht">${ICON.grid}</button>` : ''}
    <button class="icon-btn" id="account" aria-label="Konto" title="Konto">${ICON.user}</button>
  </div></div>`;
}

function bindAppbar() {
  app.querySelectorAll('[data-switch]').forEach(b => b.addEventListener('click', () => { if (b.dataset.switch !== state.company) openCompany(b.dataset.switch); }));
  const tp = $('to-picker'); if (tp) tp.addEventListener('click', renderPicker);
  $('account').addEventListener('click', openAccount);
}

/* ---------- Dashboard ---------- */
const DASH = `
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="logo" id="co-logo" aria-hidden="true">SK</div>
      <div>
        <h1 id="title"></h1>
        <div class="meta" id="meta"></div>
      </div>
    </div>
    <div class="controls" id="fin-controls">
      <select id="year" aria-label="Jahr"></select>
      <select id="period" aria-label="Zeitraum"></select>
      <button class="btn" id="upload-btn" type="button">BWA hochladen</button>
    </div>
  </header>

  <nav class="tabs" id="tabs" aria-label="Bereiche"></nav>

  <section class="panel upload" id="upload-panel" aria-live="polite" hidden>
    <div class="panel-head"><h2 id="up-h"></h2><span class="sub" id="up-file"></span></div>
    <div class="msg" id="up-msg"></div>
    <ul class="checks" id="up-checks"></ul>
    <div class="actions" id="up-actions"></div>
  </section>

  <div id="dash-body"></div>
  <div id="live-body" class="live" hidden></div>
</div>`;

const BODY = `
  <section class="tiles" id="tiles" aria-label="Die wichtigsten Zahlen"></section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <h2>Einnahmen und Ausgaben je Monat</h2>
        <p class="explain">Grün ist, was reingekommen ist, orange, was ausgegeben wurde. Ist der orange Balken höher, hat der Monat Verlust gemacht. Die Zahl unter jedem Monat ist das Ergebnis.</p>
      </div>
      <div class="legend">
        <span><i class="sw" style="--k: var(--in)"></i>Einnahmen</span>
        <span><i class="sw" style="--k: var(--out)"></i>Ausgaben</span>
      </div>
    </div>
    <div class="chart" id="flow"></div>
  </section>

  <div class="grid2">
    <section class="panel">
      <div>
        <h2>Wohin gehen 100 € Einnahmen?</h2>
        <p class="explain" id="hundred-sub"></p>
      </div>
      <div class="hundred" id="hundred"></div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2>Gewinn und Verlust je Monat</h2>
          <p class="explain">Blau heißt Gewinn, rot Verlust. Die gestrichelte Linie zählt alle Monate seit Januar zusammen und zeigt, wo das Jahr insgesamt steht.</p>
        </div>
        <div class="legend">
          <span><i class="sw" style="--k: var(--accent)"></i>Gewinn</span>
          <span><i class="sw" style="--k: var(--neg)"></i>Verlust</span>
          <span><i class="sw-line"></i>seit Januar zusammen</span>
        </div>
      </div>
      <div class="chart" id="result"></div>
    </section>
  </div>

  <section class="panel" aria-labelledby="f-h">
    <h2 id="f-h">Kurz gesagt</h2>
    <ul class="points" id="points"></ul>
  </section>

  <details class="panel" id="details">
    <summary><span><h2 style="display:inline">Alle Zahlen im Detail</h2> <span class="sub">· BWA-Monatsübersicht und Kennzahlen</span></span></summary>
    <div class="detail-grid">
      <div class="tbl-wrap"><table class="bwa" id="bwa"></table></div>
      <div class="tbl-wrap">
        <table>
          <thead><tr><th>Kennzahl</th><th>Was sie bedeutet</th><th class="r" id="ratio-col">Auswahl</th><th class="r" id="ratio-avg">Ø</th></tr></thead>
          <tbody id="ratios"></tbody>
        </table>
      </div>
    </div>
  </details>

  <footer>
    <div id="footer"></div>
    <div class="footer-links"><button type="button" id="pdf-link">Original-PDF öffnen</button></div>
  </footer>`;

function openCompany(id, year) {
  state.company = id;
  const ys = years(id);
  const p = prefs();
  state.year = year && ys.includes(year) ? year : (p.years && ys.includes(p.years[id]) ? p.years[id] : ys[0] || null);
  state.period = 'cum';
  savePrefs({ company: id });
  app.innerHTML = appbar(true) + DASH;
  bindAppbar();
  const c = company();
  $('co-logo').style.background = c.color;
  $('upload-btn').addEventListener('click', () => fileInput.click());
  $('year').addEventListener('change', e => {
    state.year = +e.target.value; state.period = 'cum';
    const ysPref = Object.assign({}, prefs().years, { [id]: state.year });
    savePrefs({ years: ysPref });
    renderDash();
  });
  $('period').addEventListener('change', e => {
    state.period = e.target.value === 'cum' ? 'cum' : +e.target.value;
    Fin.renderPeriod(state.period);
  });
  renderDash();
  const tabs = TABS[id] || TABS.tennis;
  $('tabs').innerHTML = tabs.map(([k, l]) => `<button type="button" data-tab="${k}">${l}</button>`).join('');
  $('tabs').querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const saved = (prefs().tabs || {})[id];
  showTab(tabs.some(([k]) => k === saved) ? saved : 'finanzen');
}

// Reiter: „Finanzen“ kommt aus der BWA, die übrigen sind Live-Daten aus Google Drive / eBuSy
const TABS = {
  tennis: [['finanzen', 'Finanzen'], ['umsatz', 'Umsatz'], ['trainer', 'Trainer'], ['halle', 'Halle']],
  fitness: [['finanzen', 'Finanzen'], ['umsatz', 'Umsatz'], ['training', 'Training']],
};

function showTab(tab) {
  state.tab = tab;
  savePrefs({ tabs: Object.assign({}, prefs().tabs, { [state.company]: tab }) });
  $('tabs').querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  const fin = tab === 'finanzen';
  $('dash-body').hidden = !fin;
  $('fin-controls').hidden = !fin;
  $('live-body').hidden = fin;
  if (!fin) { $('upload-panel').hidden = true; Live.render(tab, state.company, $('live-body')); }
  else if (state.year && $('flow')) Fin.redrawCharts(state.period);
}

function renderDash() {
  const c = company();
  const ys = years(c.id);
  const body = $('dash-body');
  $('year').hidden = ys.length < 2;
  $('year').innerHTML = ys.map(y => `<option value="${y}">${y}</option>`).join('');
  if (!state.year) {
    $('title').textContent = c.short;
    $('meta').innerHTML = '';
    $('period').hidden = true;
    body.innerHTML = `<section class="panel empty">
      <h2>Noch keine BWA für ${esc(c.short)}</h2>
      <p class="sub">Lade die Jahresübersicht vom Steuerbüro als PDF hoch (DATEV-BWA). Danach siehst du hier alle Zahlen.</p>
      <button class="btn" type="button" id="empty-up">BWA hochladen</button>
    </section>`;
    $('empty-up').addEventListener('click', () => fileInput.click());
    return;
  }
  $('year').value = String(state.year);
  $('period').hidden = false;
  const doc = state.docs[c.id][state.year];
  Fin.setData(doc, state.docs[c.id][state.year - 1]);
  body.innerHTML = BODY;
  Fin.renderMeta(c);
  const opt = Fin.periodOptions(state.period);
  $('period').innerHTML = opt.html;
  $('period').value = opt.value;
  state.period = opt.value === 'cum' ? 'cum' : +opt.value;
  const up = new Date(doc.uploaded_at).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  $('footer').textContent = `Vereinfachte Darstellung: „Einnahmen“ und „Ausgaben“ sind die Erträge und Kosten laut BWA, nicht die Bewegungen auf dem Bankkonto. Das Ergebnis ist vor Steuern. Quelle: DATEV-BWA, Jahresübersicht ${doc.stand}${doc.file_name ? ' (' + doc.file_name + ')' : ''}, hochgeladen am ${up}${doc.uploaded_by_name ? ' von ' + doc.uploaded_by_name : ''}. Vorläufige Zahlen, Abschluss- und Abgrenzungsbuchungen können sie noch ändern.`;
  const pl = $('pdf-link');
  pl.hidden = !doc.file_path;
  pl.addEventListener('click', () => openPdf(doc.file_path));
  Fin.renderPoints();
  Fin.renderPeriod(state.period);
}

async function openPdf(path) {
  // Fenster sofort öffnen (sonst blockiert Safari das Pop-up), Adresse danach setzen
  const w = window.open('', '_blank');
  try {
    const url = await Auth.signedUrl('bwa-pdfs', path);
    if (w) w.location = url; else location.href = url;
  } catch (e) {
    if (w) w.close();
    toast('PDF konnte nicht geöffnet werden');
  }
}

/* ---------- BWA hochladen ---------- */
const close = ['Schließen', 'ghost', () => { $('upload-panel').hidden = true; }];

function showPanel(title, msg, checks, actions, fileName) {
  const panel = $('upload-panel');
  panel.hidden = false;
  $('up-h').textContent = title;
  $('up-file').textContent = fileName || '';
  $('up-msg').innerHTML = msg || '';
  $('up-checks').innerHTML = (checks || []).map(c => `<li><span class="${c.ok ? 'up' : 'down'}">${c.ok ? '✓' : '✕'}</span> ${esc(c.text)}</li>`).join('');
  const act = $('up-actions');
  act.innerHTML = '';
  (actions || []).forEach(([txtLabel, cls, fn]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn ' + cls; b.textContent = txtLabel; b.addEventListener('click', fn);
    act.appendChild(b);
  });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function handleFile(file) {
  if (!file || !state.company) return;
  const c = company();
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showPanel('Das ist keine PDF', 'Bitte die BWA als PDF-Datei auswählen, so wie sie vom Steuerbüro kommt.', [], [close], file.name);
    return;
  }
  showPanel('BWA wird gelesen …', 'Die PDF wird in deinem Browser ausgewertet.', [], [], file.name);
  let parsed;
  try {
    parsed = await BWA.read(file);
  } catch (e) {
    showPanel('BWA konnte nicht gelesen werden', esc(e.message || String(e)), [], [close], file.name);
    return;
  }
  // Gehört die BWA zur gewählten Firma?
  const firma = parsed.firma || '';
  if (!firma.toLowerCase().includes(c.match.toLowerCase())) {
    const other = state.companies.find(o => firma.toLowerCase().includes(o.match.toLowerCase()));
    showPanel('Falsche Firma?', `Diese BWA ist von <b>${esc(firma || 'unbekannt')}</b>, du bist aber gerade bei <b>${esc(c.short)}</b>.` +
      (other ? ' Wechsle zur richtigen Firma und lade sie dort hoch.' : ''), [],
      other ? [[`Zu ${other.short} wechseln`, '', () => openCompany(other.id)], close] : [close], file.name);
    return;
  }
  const allOk = parsed.checks.every(x => x.ok);
  const n = parsed.months.length;
  const u = parsed.rows.umsatz.reduce((a, b) => a + b, 0), r = parsed.rows.evs.reduce((a, b) => a + b, 0);
  const summary = `Erkannt: <b>${esc(firma)}</b>, BWA ${esc(parsed.stand)}, ${n} Monat${n > 1 ? 'e' : ''} (${MS[parsed.months[0]]}–${MS[parsed.months[n - 1]]} ${parsed.year}). Umsatz ${eur(u)}, Ergebnis vor Steuern ${eur(r)}.`;
  const cur = (state.docs[c.id] || {})[parsed.year];
  const older = cur && parsed.months.length < cur.months.length;
  const warnOld = older ? `<br><span class="down">Achtung: Für ${parsed.year} gibt es schon einen neueren Stand (${esc(cur.stand)}). Wenn du diese übernimmst, wird sie angezeigt.</span>` : '';
  const warnChecks = allOk ? '' : '<br><span class="down">Nicht alle Summen passen. Bitte die Werte prüfen, bevor du sie übernimmst.</span>';
  showPanel(allOk ? 'BWA gelesen, Summen stimmen' : 'BWA gelesen, mit Abweichungen', summary + warnOld + warnChecks, parsed.checks, [
    ['Übernehmen und speichern', '', () => commit(parsed, file)],
    ['Verwerfen', 'ghost', () => { $('upload-panel').hidden = true; }]
  ], file.name);
}

async function commit(parsed, file) {
  const c = company();
  showPanel('Wird gespeichert …', 'Einen Moment.', [], [], file.name);
  try {
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${c.id}/${parsed.year}/${Date.now()}-${safe}`;
    await Auth.upload('bwa-pdfs', path, file);
    await Auth.insert('bwa', {
      company: c.id, year: parsed.year, firma: parsed.firma, stand: parsed.stand, erstellt: parsed.erstellt,
      months: parsed.months, rows: parsed.rows, file_name: file.name, file_path: path,
    });
    await loadAll();
    const ysPref = Object.assign({}, prefs().years, { [c.id]: parsed.year });
    savePrefs({ years: ysPref });
    openCompany(c.id, parsed.year);
    showPanel('Gespeichert', `${esc(c.short)} zeigt jetzt die BWA ${esc(parsed.stand)}. Alle mit Zugang sehen diesen Stand.`, [], [close], '');
  } catch (e) {
    showPanel('Nicht gespeichert', esc(friendlyAuthError(e)) + ' Bitte noch einmal versuchen.', [], [close], file.name);
  }
}

fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });
let dragDepth = 0;
const canDrop = () => !!state.company && state.tab === 'finanzen' && !!$('upload-btn');
window.addEventListener('dragenter', e => { if (!canDrop()) return; if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; dropHint.hidden = false; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropHint.hidden = true; });
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; dropHint.hidden = true;
  if (!canDrop()) return;
  const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f);
});

/* ---------- Konto ---------- */
function openAccount() {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<form class="card" role="dialog" aria-modal="true" aria-labelledby="acc-h" novalidate>
    <div><h2 id="acc-h">${esc(state.me.name)}</h2><div class="sub">${esc(Auth.session.user.email)} · ${state.me.role === 'admin' ? 'Admin' : 'Geschäftsführung'}</div></div>
    <label class="field">Neues Passwort<input type="password" name="pw" autocomplete="new-password" minlength="8"></label>
    <label class="field">Neues Passwort wiederholen<input type="password" name="pw2" autocomplete="new-password" minlength="8"></label>
    <p class="err" id="acc-err"></p>
    <button class="btn wide" type="submit">Passwort ändern</button>
    <button class="btn ghost wide" type="button" id="acc-out">Abmelden</button>
    <button class="btn ghost wide" type="button" id="acc-close">Schließen</button>
  </form>`;
  document.body.appendChild(bg);
  const f = bg.querySelector('form');
  const done = () => bg.remove();
  bg.addEventListener('click', e => { if (e.target === bg) done(); });
  $('acc-close').addEventListener('click', done);
  $('acc-out').addEventListener('click', () => { done(); logout(); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('acc-err');
    if (f.pw.value.length < 8) { err.textContent = 'Bitte mindestens 8 Zeichen.'; return; }
    if (f.pw.value !== f.pw2.value) { err.textContent = 'Die beiden Passwörter sind verschieden.'; return; }
    try {
      await Auth.setPassword(f.pw.value);
      done(); toast('Passwort geändert');
    } catch (x) {
      err.textContent = friendlyAuthError(x);
    }
  });
  f.pw.focus();
}

/* ---------- Updates ---------- */
async function checkForUpdate() {
  if (location.protocol === 'file:' || !navigator.onLine) return;
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version } = await res.json();
    if (version === APP_VERSION || document.querySelector('.sheet-bg') || ($('upload-panel') && !$('upload-panel').hidden)) return;
    // Schutz vor Endlos-Schleife, falls der Cache noch die alte Version liefert
    if (sessionStorage.getItem('sk-update-tried') === version) return;
    sessionStorage.setItem('sk-update-tried', version);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    location.reload();
  } catch (e) {
    console.warn('Update-Prüfung fehlgeschlagen', e);
  }
}

/* ---------- Start ---------- */
Auth.onExpired = () => renderLogin('Bitte melde dich erneut an.');

let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    if (state.tab && state.tab !== 'finanzen' && $('live-body')) Live.render(state.tab, state.company, $('live-body'));
    else if (state.company && state.year && $('flow')) Fin.redrawCharts(state.period);
  }, 150);
});

// Beim Zurückkehren in die App: nach Updates und neuen BWAs schauen
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  checkForUpdate();
  if (!Auth.session || !state.me || Date.now() - lastRefresh < 5 * 60000) return;
  if (document.querySelector('.sheet-bg') || ($('upload-panel') && !$('upload-panel').hidden)) return;
  lastRefresh = Date.now();
  try {
    await loadAll();
    if (state.company) openCompany(state.company, state.year); else renderPicker();
  } catch {}
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(e => console.warn('Service Worker nicht registriert', e));
}
boot();
checkForUpdate();
