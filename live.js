'use strict';

/* ============================================================
   Live-Reiter: Umsatz nach Bereichen, Trainer, Halle, Fitness-Training.
   Daten kommen vom Google-Baustein (google/Code.gs), aufgerufen mit dem Login-Token.
   Die Grundzahlen (Umsatz, Kosten, Ergebnis) bleiben im Reiter „Finanzen“ aus der BWA.
   ============================================================ */

const Live = (() => {
  const URL_ = (window.SK_CONFIG || {}).live || '';
  let data = null, loadedAt = 0, loading = null;
  const ui = { umsatz: {}, trainer: {}, rendite: {} };
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const n = document.createElementNS(svgNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const txt = (attrs, s, parent) => { const t = el('text', attrs, parent); t.textContent = s; return t; };
  const pct0 = v => de0.format(v) + ' %';
  const h1 = v => de1.format(v).replace(/,0$/, '') + ' h';
  const PALETTE = ['var(--c-pers)', 'var(--in)', 'var(--c-ware)', 'var(--c-werb)', 'var(--c-raum)', 'var(--out)', 'var(--accent)', 'var(--c-sonst)'];

  function configured() { return !!URL_; }

  // Lädt nur die Teile, die der Reiter braucht; bereits geladene Teile bleiben 10 Minuten gültig
  const NEEDS = { umsatz: ['umsatz'], trainer: ['trainer'], halle: ['halle'], rendite: ['rendite'] };
  const got = {};
  async function load(tab, refresh) {
    if (!configured()) throw new Error('Die Live-Daten sind noch nicht verbunden.');
    const fresh = p => got[p] && Date.now() - got[p] < 10 * 60000;
    const parts = NEEDS[tab].filter(p => refresh || !fresh(p));
    if (!parts.length) return data;
    if (loading) await loading.catch(() => {});
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
    loading = (async () => {
      let res;
      try {
        res = await fetch(URL_, { method: 'POST', signal: ctl.signal, body: JSON.stringify({ token: await Auth.token(), refresh: !!refresh, parts }) });
      } catch (e) {
        throw new Error(e.name === 'AbortError' ? 'Google antwortet gerade sehr langsam. Bitte gleich noch einmal versuchen.' : 'Keine Verbindung zu Google.');
      } finally { clearTimeout(timer); }
      const d = await res.json();
      if (d.error === 'unauthorized') throw new Error('Kein Zugriff auf die Live-Daten.');
      data = Object.assign(data || {}, d);
      parts.forEach(p => { got[p] = Date.now(); });
      loadedAt = Date.now();
      return data;
    })();
    try { return await loading; } finally { loading = null; }
  }

  function stamp() {
    if (!data) return '';
    const t = new Date(data.updated);
    return 'Stand ' + t.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) + ' Uhr';
  }

  function head(title, explain, controls) {
    return `<header class="live-head"><div><h2>${title}</h2><p class="explain">${explain}</p></div>
      <div class="controls">${controls || ''}<span class="sub" id="live-stamp">${stamp()}</span>
      <button class="btn ghost" type="button" id="live-refresh">Aktualisieren</button></div></header>`;
  }

  // ---------- Rahmen: Laden, Fehler ----------
  async function render(tab, company, host) {
    if (!configured()) {
      host.innerHTML = `<section class="panel empty"><h2>Live-Daten noch nicht verbunden</h2><p class="sub">Der Google-Baustein ist noch nicht eingerichtet.</p></section>`;
      return;
    }
    if (!data || NEEDS[tab].some(p => !data[p])) host.innerHTML = '<section class="panel empty"><p class="sub">Lade Live-Daten aus Google Drive …</p></section>';
    try {
      await load(tab, false);
    } catch (e) {
      host.innerHTML = `<section class="panel empty"><h2>Live-Daten nicht erreichbar</h2><p class="sub">${esc(e.message || e)}</p><button class="btn" type="button" id="live-retry">Erneut versuchen</button></section>`;
      $('live-retry').addEventListener('click', () => render(tab, company, host));
      return;
    }
    draw(tab, company, host);
  }

  function draw(tab, company, host) {
    const part = tab;
    if (data[part] && data[part].error) {
      host.innerHTML = `<section class="panel empty"><h2>Fehler beim Lesen</h2><p class="sub">${esc(data[part].error)}</p></section>`;
      return;
    }
    if (tab === 'umsatz') drawUmsatz(company, host);
    if (tab === 'trainer') drawTrainer(company, host, 'Trainerauslastung');
    if (tab === 'halle') drawHalle(host);
    if (tab === 'rendite') drawRendite(host);
    const rb = $('live-refresh');
    if (rb) rb.addEventListener('click', async () => {
      rb.disabled = true; rb.textContent = 'Lädt …';
      try { await load(tab, true); draw(tab, company, host); } catch (e) { toast(e.message || 'Fehler'); rb.disabled = false; rb.textContent = 'Aktualisieren'; }
    });
  }

  // ---------- Umsatz nach Bereichen ----------
  function drawUmsatz(company, host) {
    const U = data.umsatz[company] || {};
    const years = Object.keys(U).map(Number).filter(y => U[y]).sort((a, b) => b - a);
    if (!years.length) { host.innerHTML = '<section class="panel empty"><p class="sub">Keine Einnahmen in der Finanzübersicht gefunden.</p></section>'; return; }
    const st = ui.umsatz[company] = ui.umsatz[company] || {};
    const year = years.includes(st.year) ? st.year : years[0];
    const cur = data.umsatz.currentMonth, thisYear = new Date().getFullYear();
    const lastM = year === thisYear ? cur : 11;
    const groups = U[year].filter(g => g.values.slice(0, lastM + 1).some(v => v));
    const monthsWithData = [...Array(lastM + 1).keys()].filter(m => groups.some(g => g.values[m]));
    const period = st.period === undefined || (st.period !== 'cum' && !monthsWithData.includes(st.period)) ? 'cum' : st.period;
    const range = period === 'cum' ? monthsWithData : [period];
    const sumR = (vals, r) => r.reduce((s, m) => s + (vals[m] || 0), 0);
    const prev = U[year - 1] || null;
    const rows = groups.map(g => {
      const v = sumR(g.values, range);
      const pg = prev && prev.find(x => x.name === g.name);
      return { name: g.name, v, py: pg ? sumR(pg.values, range) : null, values: g.values };
    }).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
    const total = rows.reduce((s, r) => s + r.v, 0);
    const pyTotal = prev ? prev.reduce((s, g) => s + sumR(g.values, range), 0) : null;
    const big = rows.filter(r => r.v / total >= 0.015), small = rows.filter(r => r.v / total < 0.015);
    if (small.length) big.push({ name: 'Weitere', v: small.reduce((s, r) => s + r.v, 0), py: null, title: small.map(r => r.name).join(', ') });
    const label = period === 'cum' ? `${MS[range[0]]}–${MS[range[range.length - 1]]} ${year}` + (year === thisYear && range.includes(cur) ? ' (bis heute)' : '') : `${ML[period]} ${year}` + (year === thisYear && period === cur ? ' (läuft noch)' : '');
    const opts = `<option value="cum">${MS[monthsWithData[0]]}–${MS[monthsWithData[monthsWithData.length - 1]]} ${year}</option>` +
      monthsWithData.slice().reverse().map(m => `<option value="${m}">${ML[m]} ${year}${year === thisYear && m === cur ? ' (läuft)' : ''}</option>`).join('');
    const ysel = years.length > 1 ? `<select id="u-year" aria-label="Jahr">${years.map(y => `<option value="${y}">${y}</option>`).join('')}</select>` : '';
    host.innerHTML = head('Umsatz nach Bereichen',
      'Woher das Geld kommt, aus der Finanzübersicht (Zahlungseingänge, live). Die Gesamtzahlen im Reiter „Finanzen“ kommen aus der BWA, deshalb kann die Summe hier etwas abweichen.',
      `${ysel}<select id="u-period" aria-label="Zeitraum">${opts}</select>`) +
      `<section class="panel"><div class="panel-head"><h2>${esc(label)}</h2><span class="sub">zusammen ${eur(total)}${pyTotal ? ` · Vorjahr ${eur(pyTotal)}` : ''}</span></div>
        <ul class="mix">${big.map((r, i) => {
          const share = r.v / total * 100;
          const d = r.py ? (r.v / r.py - 1) * 100 : null;
          return `<li title="${esc(r.title || '')}"><span class="mix-name"><i class="sw" style="--k:${PALETTE[i % PALETTE.length]}"></i>${esc(r.name)}</span>
            <span class="mix-bar"><span style="width:${share / (big[0].v / total * 100) * 100}%; background:${PALETTE[i % PALETTE.length]}"></span></span>
            <span class="mix-pct num">${de1.format(share)} %</span><span class="mix-eur num">${eur(r.v)}</span>
            <span class="mix-py num ${d === null ? '' : d >= 0 ? 'up' : 'down'}">${d === null ? '' : (d >= 0 ? '▲ +' : '▼ −') + de0.format(Math.abs(d)) + ' %'}</span></li>`;
        }).join('')}</ul>
        <p class="hint">▲▼ = Veränderung zum gleichen Zeitraum im Vorjahr.</p></section>`;
    if ($('u-year')) { $('u-year').value = String(year); $('u-year').addEventListener('change', e => { st.year = +e.target.value; st.period = 'cum'; drawUmsatz(company, host); bindRefresh(host, 'umsatz', company); }); }
    $('u-period').value = String(period);
    $('u-period').addEventListener('change', e => { st.period = e.target.value === 'cum' ? 'cum' : +e.target.value; drawUmsatz(company, host); bindRefresh(host, 'umsatz', company); });
  }

  // ---------- Trainerauslastung ----------
  function trainerBlock(rows, months, st, idPrefix) {
    const now = new Date(), curIdx = months.length - 1;
    const sel = st.month === undefined ? curIdx - 1 : st.month;
    const mm = months[sel], isCur = sel === curIdx;
    const dim = new Date(mm.y, mm.m + 1, 0).getDate();
    const frac = isCur ? Math.min(1, now.getDate() / dim) : 1;
    const opts = months.map((x, i) => i).reverse().map(i => `<option value="${i}">${ML[months[i].m]} ${months[i].y}${i === curIdx ? ' (bis heute)' : ''}</option>`).join('');
    // Soll steht als Stunden pro Woche in der Einstellungs-Tabelle → auf den Monat umrechnen (Tage ÷ 7).
    // Werte über 60 sind ältere Monatswerte und werden direkt genommen.
    const monthSoll = s => s ? (s > 60 ? s : s * dim / 7) : null;
    // Urlaub laut Jahreskalender: je Urlaubstag (Mo–Fr) sinkt das Soll um ein Fünftel des Wochen-Solls (30 h → 6 h)
    const vacH = (r, i) => r.urlaub && r.urlaub[i] && r.soll && r.soll <= 60 ? r.urlaub[i] * r.soll / 5 : 0;
    const list = rows.map(r => ({ name: r.name, ist: r.ist[sel], soll: r.soll ? Math.max(0, monthSoll(r.soll) * frac - vacH(r, sel)) : null, week: r.soll && r.soll <= 60 ? r.soll : null, vac: r.urlaub ? r.urlaub[sel] || 0 : 0 })).filter(r => r.ist !== null);
    const weeks = [...new Set(list.map(r => r.week).filter(Boolean))];
    const sollTxt = weeks.length === 1 ? `Soll = ${h1(weeks[0])} pro Woche, im ${ML[mm.m]} also ${h1(weeks[0] * dim / 7)}` : 'Soll je Trainer laut Einstellungs-Tabelle';
    const withSoll = list.filter(r => r.soll);
    const tIst = withSoll.reduce((s, r) => s + r.ist, 0), tSoll = withSoll.reduce((s, r) => s + r.soll, 0);
    // Jahresschnitt: alle Monate des laufenden Jahres bis heute (aktueller Monat anteilig)
    const yr = now.getFullYear();
    const yIdx = months.map((x, i) => i).filter(i => months[i].y === yr);
    const sollAt = (s, i) => {
      if (!s) return 0;
      const d = new Date(months[i].y, months[i].m + 1, 0).getDate();
      const f = i === curIdx ? Math.min(1, now.getDate() / d) : 1;
      return (s > 60 ? s : s * d / 7) * f;
    };
    const yearList = rows.filter(r => r.soll).map(r => {
      const ist = yIdx.reduce((s, i) => s + (r.ist[i] || 0), 0);
      return { name: r.name, ist, soll: yIdx.reduce((s, i) => s + (r.ist[i] === null ? 0 : Math.max(0, sollAt(r.soll, i) - vacH(r, i))), 0), vac: yIdx.reduce((s, i) => s + (r.urlaub ? r.urlaub[i] || 0 : 0), 0) };
    }).filter(r => r.soll > 0);
    const yIst = yearList.reduce((s, r) => s + r.ist, 0), ySoll = yearList.reduce((s, r) => s + r.soll, 0);
    const barList = (items) => {
      const mx = Math.max(1, ...items.map(r => Math.max(r.ist, r.soll || 0))) * 1.08;
      return items.map(r => {
        const p = r.soll ? r.ist / r.soll * 100 : null;
        const cls = p === null ? '' : p >= 95 ? 'good' : p >= 80 ? 'warn' : 'crit';
        return `<li><span class="tr-name">${esc(r.name)}${r.vac ? `<small class="vac">${r.vac} Tage Urlaub</small>` : ''}</span>
          <span class="tr-bar"><span class="tr-ist ${cls}" style="width:${r.ist / mx * 100}%"></span>${r.soll ? `<span class="tr-soll" style="left:${r.soll / mx * 100}%" title="Soll ${h1(r.soll)}"></span>` : ''}</span>
          <span class="num tr-val">${h1(Math.round(r.ist))}${r.soll ? ` <small>/ ${h1(Math.round(r.soll))}</small>` : ''}</span>
          <span class="num tr-pct ${cls}">${p === null ? '–' : pct0(p)}</span></li>`;
      }).join('');
    };
    const yearHtml = yearList.length ? `<section class="panel"><div class="panel-head"><h2>Jahresschnitt ${yr}</h2>
        <span class="sub">${MS[months[yIdx[0]].m]}–heute · Team: ${h1(Math.round(yIst))} von ${h1(Math.round(ySoll))} · <b>${pct0(yIst / ySoll * 100)}</b></span></div>
        <ul class="trainers">${barList(yearList)}</ul>
        <p class="hint">Alle Stunden seit Januar gegenüber dem Soll seit Januar (laufender Monat anteilig bis heute). Urlaub laut Jahreskalender ist abgezogen: 6 h je Urlaubstag (Mo–Fr).</p></section>` : '';
    const maxV = Math.max(1, ...list.map(r => Math.max(r.ist, r.soll || 0))) * 1.08;
    const bars = list.map(r => {
      const p = r.soll ? r.ist / r.soll * 100 : null;
      const cls = p === null ? '' : p >= 95 ? 'good' : p >= 80 ? 'warn' : 'crit';
      return `<li><span class="tr-name">${esc(r.name)}${r.vac ? `<small class="vac">${r.vac} Tage Urlaub</small>` : ''}</span>
        <span class="tr-bar"><span class="tr-ist ${cls}" style="width:${r.ist / maxV * 100}%"></span>${r.soll ? `<span class="tr-soll" style="left:${r.soll / maxV * 100}%" title="Soll ${h1(r.soll)}"></span>` : ''}</span>
        <span class="num tr-val">${h1(r.ist)}${r.soll ? ` <small>/ ${h1(r.soll)}</small>` : ''}</span>
        <span class="num tr-pct ${cls}">${p === null ? '–' : pct0(p)}</span></li>`;
    }).join('');
    return {
      controls: `<select id="${idPrefix}-month" aria-label="Monat">${opts}</select>`,
      html: `<section class="panel"><div class="panel-head"><h2>${ML[mm.m]} ${mm.y}${isCur ? ' (bis heute)' : ''}</h2>
          ${tSoll ? `<span class="sub">Team: ${h1(tIst)} von ${h1(tSoll)} · <b>${pct0(tIst / tSoll * 100)}</b></span>` : ''}</div>
          <ul class="trainers">${bars || '<li class="sub">Keine Stundenliste für diesen Monat gefunden.</li>'}</ul>
          <p class="hint"><b>${sollTxt}${isCur ? ', anteilig bis heute' : ''}.</b> Balken = gearbeitete Stunden laut Stundenliste, Strich = Soll. Grün ab 95 %, gelb ab 80 %.</p></section>` + yearHtml,
      bind: redraw => { const s = $(idPrefix + '-month'); s.value = String(sel); s.addEventListener('change', e => { st.month = +e.target.value; redraw(); }); },
    };
  }

  function drawTrainer(company, host) {
    const T = data.trainer;
    const rows = T.rows.filter(r => r.co === company);
    const st = ui.trainer[company] = ui.trainer[company] || {};
    const b = trainerBlock(rows, T.months, st, 'tr');
    host.innerHTML = head('Trainerauslastung', 'Gearbeitete Stunden aus „SK – Stundenlisten“ gegenüber dem Soll von 30 Stunden pro Woche. Das Soll lässt sich je Trainer in der Einstellungs-Tabelle in Google Drive ändern.', b.controls) + b.html;
    b.bind(() => { drawTrainer(company, host); bindRefresh(host, 'trainer', company); });
  }

  // ---------- Rentabilität je Bereich ----------
  function drawRendite(host) {
    const R = data.rendite;
    const st = ui.rendite;
    const cur = R.currentMonth;
    const done = [...Array(cur).keys()]; // abgeschlossene Monate
    const period = st.period === undefined ? (cur > 0 ? 'cum' : 'cumNow') : st.period;
    const range = period === 'cum' ? done : period === 'cumNow' ? [...done, cur] : [period];
    const S = a => range.reduce((s, m) => s + (a[m] || 0), 0);
    const rows = R.areas.map(a => ({ name: a.name, rev: S(a.rev), cost: S(a.cost), hours: S(a.hours) })).filter(r => r.rev || r.cost);
    rows.forEach(r => { r.db = r.rev - r.cost; r.marge = r.rev ? r.db / r.rev * 100 : null; });
    rows.sort((a, b) => b.rev - a.rev);
    const sumRev = rows.reduce((s, r) => s + r.rev, 0), sumDb = rows.reduce((s, r) => s + r.db, 0);
    const gf = S(R.gf), gem = S(R.gem), ust = S(R.ust || []), erg = sumDb - gf - gem - ust;
    const hTot = rows.reduce((s, r) => s + r.hours, 0);
    const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.marge || 0)));
    const label = period === 'cum' ? `${MS[0]}–${MS[cur - 1]} ${R.year}` : period === 'cumNow' ? `${MS[0]}–${MS[cur]} ${R.year} (bis heute)` : `${ML[period]} ${R.year}`;
    const opts = (cur > 0 ? `<option value="cum">${MS[0]}–${MS[cur - 1]} ${R.year} (abgeschlossene Monate)</option>` : '') +
      `<option value="cumNow">${MS[0]}–${MS[cur]} ${R.year} (inkl. laufender Monat)</option>` +
      done.slice().reverse().map(m => `<option value="${m}">${ML[m]} ${R.year}</option>`).join('');
    const line = (n, v, cls) => `<tr class="${cls || ''}"><td>${n}</td><td></td><td></td><td class="r num ${v < 0 ? 'down' : ''}">${eurS(v)}</td><td></td><td></td></tr>`;
    host.innerHTML = head('Rentabilität je Bereich',
      'Umsatz und Kosten je Bereich aus der Finanzübersicht (Zahlungen; Umsätze inkl. Umsatzsteuer, die USt wird am Ende abgezogen). Alle Trainergehälter, auch die von Kevin und Philipp, werden nach den Stunden laut Stundenlisten verteilt (VS = Akademie, (VS) halb/halb, Club, sonst Privat; BZ zählt nicht). Gemeinkosten werden erst am Ende abgezogen.',
      `<select id="r-period" aria-label="Zeitraum">${opts}</select>`) +
      `<section class="panel"><div class="panel-head"><h2>${esc(label)}</h2><span class="sub">Deckungsbeitrag aller Bereiche: <b>${eurS(sumDb)}</b></span></div>
        <div class="tbl-wrap"><table class="rendite">
          <thead><tr><th>Bereich</th><th class="r">Umsatz</th><th class="r">Kosten</th><th class="r">Deckungsbeitrag</th><th>Marge</th><th class="r">Trainerstd.</th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${eur(r.rev)}</td><td class="r num">${eur(r.cost)}</td>
            <td class="r num ${r.db < 0 ? 'down' : ''}"><b>${eurS(r.db)}</b></td>
            <td class="marge">${r.marge === null ? '–' : `<span class="mbar"><span class="${r.marge < 0 ? 'neg' : ''}" style="width:${Math.min(100, Math.abs(r.marge) / maxAbs * 100)}%"></span></span><span class="num ${r.marge < 0 ? 'down' : ''}">${de0.format(r.marge)} %</span>`}</td>
            <td class="r num sub">${r.hours ? de0.format(r.hours) + ' h' + (hTot ? ` · ${de0.format(r.hours / hTot * 100)} %` : '') : ''}</td></tr>`).join('')}</tbody>
          <tfoot>
            <tr class="sum"><td>Summe Bereiche</td><td class="r num">${eur(sumRev)}</td><td></td><td class="r num"><b>${eurS(sumDb)}</b></td><td>${sumRev ? de0.format(sumDb / sumRev * 100) + ' %' : ''}</td><td></td></tr>
            ${gf ? line('− Geschäftsführung', -gf) : ''}
            ${line('− Gemeinkosten (Büro, Steuerberater, Versicherungen, Auto …)', -gem)}
            ${ust ? line('− Umsatzsteuer (an das Finanzamt gezahlt)', -ust) : ''}
            ${line('= Ergebnis laut Finanzübersicht', erg, 'sum key')}
          </tfoot></table></div>
        <p class="hint">Marge = Deckungsbeitrag ÷ Umsatz. Das Ergebnis hier ist eine Zahlungssicht und weicht von der BWA ab (z. B. Abgrenzungen, Umsatzsteuer, Zahlungszeitpunkte). Zuordnung der Kosten änderbar im Blatt „Kosten-Zuordnung“ der Einstellungs-Tabelle.</p></section>`;
    const sel = $('r-period');
    sel.value = String(period);
    sel.addEventListener('change', e => { const v = e.target.value; st.period = v === 'cum' || v === 'cumNow' ? v : +v; drawRendite(host); bindRefresh(host, 'rendite'); });
  }

  // ---------- Halle ----------
  function drawHalle(host) {
    const H = data.halle;
    const cap = H.courts * (H.close - H.open);
    const byDate = {}; H.days.forEach(d => { byDate[d.d] = d; });
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const monday = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
    const week = start => {
      let min = 0, t = 0, n = 0;
      for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(d.getDate() + i); const r = byDate[iso(d)]; if (r) { min += r.min; t += r.t || 0; n++; } }
      return { start, min, t, n, p: n ? min / (n * cap) * 100 : null };
    };
    const thisMon = monday(today);
    const weeks = [];
    for (let i = -15; i <= 2; i++) { const s = new Date(thisMon); s.setDate(s.getDate() + i * 7); weeks.push(Object.assign(week(s), { future: i > 0, current: i === 0 })); }
    const W0 = weeks[15], Wm1 = weeks[14], Wp1 = weeks[16];
    const last4 = weeks.slice(11, 15), l4min = last4.reduce((s, w) => s + w.min, 0), l4n = last4.reduce((s, w) => s + w.n, 0), l4t = last4.reduce((s, w) => s + w.t, 0);
    const ph = w => w.n ? `<b>${de1.format(w.min / 60).replace(/,0$/, '')} von ${de0.format(w.n * cap / 60)} Platzstunden</b>` : 'noch keine Daten';
    const trainTxt = w =>w.min ? ` · davon ${de0.format(w.t / w.min * 100)} % eigenes Training` : '';
    const fmtW = w => `${w.start.getDate()}.${w.start.getMonth() + 1}.`;
    // Vorjahr: dieselbe Kalenderwoche (52 Wochen zurück, gleiche Wochentage)
    const pyWeek = w => { const s = new Date(w.start); s.setDate(s.getDate() - 364); return week(s); };
    const pyTxt = (p, py) => py === null || p === null ? '' : `<div class="delta"><span class="${p >= py ? 'up' : 'down'}">${p >= py ? '▲' : '▼'} ${sgn(p - py, x => de0.format(x))} Pkt.</span><span class="cmp">ggü. Vorjahr (${pct0(py)})</span></div>`;
    const l4py = (() => { const ws = last4.map(pyWeek), m = ws.reduce((s, w) => s + w.min, 0), n = ws.reduce((s, w) => s + w.n, 0); return n ? m / (n * cap) * 100 : null; })();
    const tile = (l, p, sub, k, py) => `<article class="tile"><div class="label"><i class="sw" style="--k:${k}"></i>${l}</div><div class="value num">${p === null ? '–' : pct0(p)}</div>${pyTxt(p, py === undefined ? null : py)}<div class="what">${sub}</div></article>`;
    const oh = Math.floor(H.open / 60);
    const since = H.since ? new Date(H.since + 'T12:00:00') : null;
    const missing = !since || since > weeks[0].start;
    host.innerHTML = head('Hallenauslastung', `Alle Belegungen aus eBuSy (Einzel- und Abobuchungen, auch von Externen, plus eigenes Training) auf ${H.courts} Plätzen, gezählt ${String(oh).padStart(2, '0')}–${Math.ceil(H.close / 60)} Uhr. 100 % = jede Stunde auf jedem Platz belegt.`) +
      `<section class="tiles">${tile('Diese Woche', W0.p, `${ph(W0)} · ab ${fmtW(W0)}, inkl. schon gebuchter Tage${trainTxt(W0)}`, 'var(--accent)', pyWeek(W0).p)}
        ${tile('Letzte Woche', Wm1.p, `${ph(Wm1)} · ab ${fmtW(Wm1)}${trainTxt(Wm1)}`, 'var(--c-sonst)', pyWeek(Wm1).p)}
        ${tile('Nächste Woche', Wp1.p, `${ph(Wp1)} · schon gebucht`, 'var(--in)')}
        ${tile('Letzte 4 Wochen', l4n ? l4min / (l4n * cap) * 100 : null, `${de0.format(l4min / 60)} von ${de0.format(l4n * cap / 60)} Platzstunden${l4min ? ' · davon ' + de0.format(l4t / l4min * 100) + ' % Training' : ''}`, 'var(--c-pers)', l4py)}</section>
      <section class="panel"><div><h2>Auslastung je Woche</h2><p class="explain">Helle Säulen sind kommende Wochen: so viel ist schon gebucht.${missing ? ` eBuSy zeigt vergangene Tage nicht an. Die Belegung wird deshalb seit ${since ? since.toLocaleDateString('de-DE') : 'heute'} stündlich gespeichert, die Historie wächst ab dann.` : ''}</p></div><div class="chart" id="h-weeks"></div></section>`;
    bars($('h-weeks'), weeks.map(w => ({ label: fmtW(w), v: w.p || 0, top: w.p === null ? '' : de0.format(w.p), future: w.future, hl: w.current })), v => v + ' %', 100);
  }

  // Einfache Säulengrafik
  function bars(host, items, fmt, fixedMax) {
    if (!host) return;
    const W = Math.max(host.clientWidth, 300), Hh = 220, m = { t: 18, r: 6, b: 24, l: 44 };
    const iw = W - m.l - m.r, ih = Hh - m.t - m.b;
    const top = fixedMax || Math.max(1, ...items.map(i => i.v));
    const step = top / 4, slot = iw / items.length, bw = Math.min(30, slot * 0.66);
    const svg = el('svg', { viewBox: `0 0 ${W} ${Hh}`, height: Hh, role: 'img' }, host);
    for (let k = 0; k <= 4; k++) {
      const y = m.t + ih - k / 4 * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: k ? 'var(--grid)' : 'var(--axis)' }, svg);
      txt({ x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, fmt(Math.round(step * k)), svg);
    }
    items.forEach((it, i) => {
      const x = m.l + i * slot + (slot - bw) / 2, h = it.v / top * ih;
      if (it.hl) el('rect', { x: m.l + i * slot, y: m.t, width: slot, height: ih + 20, fill: 'var(--hl)', rx: 4 }, svg);
      el('rect', { x, y: m.t + ih - h, width: bw, height: Math.max(h, 0), rx: 3, fill: 'var(--accent)', opacity: it.future ? 0.35 : 1 }, svg);
      if (it.top) txt({ x: x + bw / 2, y: m.t + ih - h - 4, 'text-anchor': 'middle', style: 'font-size:10px; fill: var(--ink-2)' }, it.top, svg);
      if (items.length <= 14 || i % 2 === 0) txt({ x: x + bw / 2, y: Hh - 6, 'text-anchor': 'middle' }, it.label, svg);
    });
  }

  function bindRefresh(host, tab, company) {
    const rb = $('live-refresh');
    if (rb) rb.addEventListener('click', async () => {
      rb.disabled = true; rb.textContent = 'Lädt …';
      try { await load(tab, true); draw(tab, company, host); } catch (e) { toast(e.message || 'Fehler'); }
    });
  }

  function reset() { data = null; loadedAt = 0; Object.keys(got).forEach(k => delete got[k]); }

  // Einzelnen Datenteil holen (z. B. für den Finanzen-Reiter)
  async function part(name) { await load(name, false); return data && data[name]; }

  return { render, configured, reset, part };
})();
