'use strict';

/* ============================================================
   Live-Reiter: Umsatz nach Bereichen, Trainer, Halle, Fitness-Training.
   Daten kommen vom Google-Baustein (google/Code.gs), aufgerufen mit dem Login-Token.
   Die Grundzahlen (Umsatz, Kosten, Ergebnis) bleiben im Reiter „Finanzen“ aus der BWA.
   ============================================================ */

const Live = (() => {
  const URL_ = (window.SK_CONFIG || {}).live || '';
  let data = null, loadedAt = 0, loading = null;
  const ui = { umsatz: {}, trainer: {}, training: {} };
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

  async function load(refresh) {
    if (!configured()) throw new Error('Die Live-Daten sind noch nicht verbunden.');
    if (data && !refresh && Date.now() - loadedAt < 10 * 60000) return data;
    if (loading) return loading;
    loading = (async () => {
      const res = await fetch(URL_, { method: 'POST', body: JSON.stringify({ token: await Auth.token(), refresh: !!refresh }) });
      const d = await res.json();
      if (d.error === 'unauthorized') throw new Error('Kein Zugriff auf die Live-Daten.');
      data = d; loadedAt = Date.now();
      return d;
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
    if (!data) host.innerHTML = '<section class="panel empty"><p class="sub">Lade Live-Daten aus Google Drive …</p></section>';
    try {
      await load(false);
    } catch (e) {
      host.innerHTML = `<section class="panel empty"><h2>Live-Daten nicht erreichbar</h2><p class="sub">${esc(e.message || e)}</p><button class="btn" type="button" id="live-retry">Erneut versuchen</button></section>`;
      $('live-retry').addEventListener('click', () => render(tab, company, host));
      return;
    }
    draw(tab, company, host);
  }

  function draw(tab, company, host) {
    const part = { umsatz: 'umsatz', trainer: 'trainer', halle: 'halle', training: 'fitness' }[tab];
    if (data[part] && data[part].error) {
      host.innerHTML = `<section class="panel empty"><h2>Fehler beim Lesen</h2><p class="sub">${esc(data[part].error)}</p></section>`;
      return;
    }
    if (tab === 'umsatz') drawUmsatz(company, host);
    if (tab === 'trainer') drawTrainer(company, host, 'Trainerauslastung');
    if (tab === 'halle') drawHalle(host);
    if (tab === 'training') drawTraining(host);
    const rb = $('live-refresh');
    if (rb) rb.addEventListener('click', async () => {
      rb.disabled = true; rb.textContent = 'Lädt …';
      try { await load(true); draw(tab, company, host); } catch (e) { toast(e.message || 'Fehler'); rb.disabled = false; rb.textContent = 'Aktualisieren'; }
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
        <p class="hint">▲▼ = Veränderung zum gleichen Zeitraum im Vorjahr.</p></section>
      <section class="panel"><div><h2>Anteile je Monat</h2><p class="explain">Jede Säule ist ein Monat (100 %). So sieht man, wie sich die Mischung im Jahr verschiebt.</p></div>
        <div class="legend">${big.map((r, i) => `<span><i class="sw" style="--k:${PALETTE[i % PALETTE.length]}"></i>${esc(r.name)}</span>`).join('')}</div>
        <div class="chart" id="u-stack"></div></section>`;
    if ($('u-year')) { $('u-year').value = String(year); $('u-year').addEventListener('change', e => { st.year = +e.target.value; st.period = 'cum'; drawUmsatz(company, host); bindRefresh(host, 'umsatz', company); }); }
    $('u-period').value = String(period);
    $('u-period').addEventListener('change', e => { st.period = e.target.value === 'cum' ? 'cum' : +e.target.value; drawUmsatz(company, host); bindRefresh(host, 'umsatz', company); });
    // 100%-Säulen je Monat
    const names = big.map(r => r.name), smallNames = small.map(r => r.name);
    const series = monthsWithData.map(m => {
      const vals = names.map(n => n === 'Weitere' ? groups.filter(g => smallNames.includes(g.name)).reduce((s, g) => s + g.values[m], 0) : (groups.find(g => g.name === n) || { values: [] }).values[m] || 0);
      return { m, vals, sum: vals.reduce((a, b) => a + b, 0) };
    });
    stack100($('u-stack'), series, names, period);
  }

  function stack100(host, series, names, sel) {
    const W = Math.max(host.clientWidth, 300), H = 240, m = { t: 8, r: 8, b: 24, l: 40 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b, slot = iw / Math.max(series.length, 1), bw = Math.min(38, slot * 0.7);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Anteile je Monat' }, host);
    [0, 50, 100].forEach(p => {
      const y = m.t + ih - p / 100 * ih;
      el('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: 'var(--grid)' }, svg);
      txt({ x: m.l - 6, y: y + 4, 'text-anchor': 'end' }, p + ' %', svg);
    });
    series.forEach((s, i) => {
      const x = m.l + i * slot + (slot - bw) / 2;
      let y = m.t + ih;
      s.vals.forEach((v, k) => {
        const h = s.sum ? v / s.sum * ih : 0;
        if (h > 0) { const r = el('rect', { x, y: y - h, width: bw, height: Math.max(h - 1, 0), fill: PALETTE[k % PALETTE.length], opacity: sel === 'cum' || sel === s.m ? 1 : 0.35 }, svg); el('title', {}, r).textContent = `${ML[s.m]}: ${names[k]} ${de1.format(v / s.sum * 100)} % (${eur(v)})`; }
        y -= h;
      });
      txt({ x: x + bw / 2, y: H - 6, 'text-anchor': 'middle' }, MS[s.m], svg);
    });
  }

  // ---------- Trainerauslastung ----------
  function trainerBlock(rows, months, st, idPrefix) {
    const now = new Date(), curIdx = months.length - 1;
    const sel = st.month === undefined ? curIdx - 1 : st.month;
    const mm = months[sel], isCur = sel === curIdx;
    const dim = new Date(mm.y, mm.m + 1, 0).getDate();
    const frac = isCur ? Math.min(1, now.getDate() / dim) : 1;
    const opts = months.map((x, i) => i).reverse().map(i => `<option value="${i}">${ML[months[i].m]} ${months[i].y}${i === curIdx ? ' (bis heute)' : ''}</option>`).join('');
    const list = rows.map(r => ({ name: r.name, ist: r.ist[sel], soll: r.soll ? r.soll * frac : null })).filter(r => r.ist !== null);
    const withSoll = list.filter(r => r.soll);
    const tIst = withSoll.reduce((s, r) => s + r.ist, 0), tSoll = withSoll.reduce((s, r) => s + r.soll, 0);
    const maxV = Math.max(1, ...list.map(r => Math.max(r.ist, r.soll || 0))) * 1.08;
    const bars = list.map(r => {
      const p = r.soll ? r.ist / r.soll * 100 : null;
      const cls = p === null ? '' : p >= 95 ? 'good' : p >= 80 ? 'warn' : 'crit';
      return `<li><span class="tr-name">${esc(r.name)}</span>
        <span class="tr-bar"><span class="tr-ist ${cls}" style="width:${r.ist / maxV * 100}%"></span>${r.soll ? `<span class="tr-soll" style="left:${r.soll / maxV * 100}%" title="Soll ${h1(r.soll)}"></span>` : ''}</span>
        <span class="num tr-val">${h1(r.ist)}${r.soll ? ` <small>/ ${h1(r.soll)}</small>` : ''}</span>
        <span class="num tr-pct ${cls}">${p === null ? '–' : pct0(p)}</span></li>`;
    }).join('');
    // Verlauf: Auslastung je Trainer und Monat
    const grid = `<div class="tbl-wrap"><table class="heat"><thead><tr><th>Trainer</th>${months.map((x, i) => `<th class="r${i === sel ? ' sel' : ''}">${MS[x.m]}${x.m === 0 || i === 0 ? ' ' + String(x.y).slice(2) : ''}</th>`).join('')}</tr></thead><tbody>` +
      rows.map(r => `<tr><td>${esc(r.name)}</td>${r.ist.map((v, i) => {
        if (v === null) return `<td class="r${i === sel ? ' sel' : ''}"></td>`;
        if (!r.soll) return `<td class="r num${i === sel ? ' sel' : ''}">${de0.format(v)} h</td>`;
        const f = i === curIdx ? Math.min(1, now.getDate() / new Date(months[i].y, months[i].m + 1, 0).getDate()) : 1;
        const p = v / (r.soll * f) * 100;
        return `<td class="r num ${p >= 95 ? 'h-good' : p >= 80 ? 'h-warn' : 'h-crit'}${i === sel ? ' sel' : ''}">${de0.format(p)} %</td>`;
      }).join('')}</tr>`).join('') + '</tbody></table></div>';
    return {
      controls: `<select id="${idPrefix}-month" aria-label="Monat">${opts}</select>`,
      html: `<section class="panel"><div class="panel-head"><h2>${ML[mm.m]} ${mm.y}${isCur ? ' (bis heute)' : ''}</h2>
          ${tSoll ? `<span class="sub">Team: ${h1(tIst)} von ${h1(tSoll)} · <b>${pct0(tIst / tSoll * 100)}</b></span>` : ''}</div>
          <ul class="trainers">${bars || '<li class="sub">Keine Stundenliste für diesen Monat gefunden.</li>'}</ul>
          <p class="hint">Balken = gearbeitete Stunden laut Stundenliste, Strich = Soll${isCur ? ' (anteilig bis heute)' : ''}. Grün ab 95 %, gelb ab 80 %.</p></section>
        <section class="panel"><div><h2>Verlauf</h2><p class="explain">Auslastung gegenüber Soll je Monat. Ohne Soll werden die Stunden gezeigt.</p></div>${grid}</section>`,
      bind: redraw => { const s = $(idPrefix + '-month'); s.value = String(sel); s.addEventListener('change', e => { st.month = +e.target.value; redraw(); }); },
    };
  }

  function drawTrainer(company, host) {
    const T = data.trainer;
    const rows = T.rows.filter(r => r.co === company);
    const st = ui.trainer[company] = ui.trainer[company] || {};
    const b = trainerBlock(rows, T.months, st, 'tr');
    host.innerHTML = head('Trainerauslastung', 'Gearbeitete Stunden aus „SK – Stundenlisten“ gegenüber den Soll-Stunden. Soll-Stunden lassen sich in der Einstellungs-Tabelle in Google Drive ändern.', b.controls) + b.html;
    b.bind(() => { drawTrainer(company, host); bindRefresh(host, 'trainer', company); });
  }

  // ---------- Fitness: Training ----------
  function drawTraining(host) {
    const F = data.fitness, T = data.trainer;
    const st = ui.training;
    const rows = T && T.rows ? T.rows.filter(r => r.co === 'fitness') : [];
    const b = trainerBlock(rows, T.months, st, 'ft');
    const ms = F.months, D = F.data;
    const sel = st.month === undefined ? ms.length - 2 : st.month;
    const cur = D[sel], prev = D[sel - 1];
    const delta = (a, b2, f) => (a && b2 && b2[f]) ? `<span class="${a[f] >= b2[f] ? 'up' : 'down'}">${a[f] >= b2[f] ? '▲' : '▼'} ${f === 'umsatz' ? eurS(a[f] - b2[f]) : sgn(a[f] - b2[f], x => de0.format(x))}</span><span class="cmp">ggü. ${MS[ms[sel - 1].m]}</span>` : '';
    const tiles = cur ? [
      ['Kunden mit Training', de0.format(cur.kunden), delta(cur, prev, 'kunden'), 'var(--c-pers)'],
      ['Einheiten', de0.format(cur.einheiten), delta(cur, prev, 'einheiten'), 'var(--in)'],
      ['Trainingsumsatz', eur(cur.umsatz), delta(cur, prev, 'umsatz'), 'var(--accent)'],
    ].map(([l, v, d, k]) => `<article class="tile"><div class="label"><i class="sw" style="--k:${k}"></i>${l}</div><div class="value num">${v}</div><div class="delta">${d}</div></article>`).join('') : '<p class="sub">Keine Abrechnung für diesen Monat gefunden.</p>';
    host.innerHTML = head('Training Fitness', 'Kunden, Einheiten und Umsatz aus der „Trainingsabrechnung Fitness“, dazu die Auslastung laut Stundenliste.', b.controls) +
      `<section class="tiles tiles-3">${tiles}</section>
       <section class="panel"><div><h2>Trainingsumsatz je Monat</h2><p class="explain">Rechnungssumme aller Kunden laut Trainingsabrechnung. Die Zahl über der Säule ist die Anzahl Kunden.</p></div><div class="chart" id="ft-chart"></div></section>` + b.html;
    b.bind(() => { drawTraining(host); bindRefresh(host, 'training'); });
    bars($('ft-chart'), ms.map((x, i) => ({ label: MS[x.m], v: D[i] ? D[i].umsatz : 0, top: D[i] ? de0.format(D[i].kunden) : '', hl: i === sel })), v => tsd(v));
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
    const trainTxt = w => w.min ? ` · davon ${de0.format(w.t / w.min * 100)} % eigenes Training` : '';
    const fmtW = w => `${w.start.getDate()}.${w.start.getMonth() + 1}.`;
    const tile = (l, p, sub, k) => `<article class="tile"><div class="label"><i class="sw" style="--k:${k}"></i>${l}</div><div class="value num">${p === null ? '–' : pct0(p)}</div><div class="what">${sub}</div></article>`;
    const hours = (H.close - H.open) / 60, oh = Math.floor(H.open / 60);
    // Wochentag × Stunde, letzte 8 abgeschlossene Wochen
    const heat = Array.from({ length: 7 }, () => new Array(Math.ceil(hours)).fill(0)), cnt = new Array(7).fill(0);
    for (let i = -14; i <= 56; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const r = byDate[iso(d)]; if (!r) continue;
      const wd = (d.getDay() + 6) % 7; cnt[wd]++;
      r.h.forEach((m, k) => { if (k < heat[wd].length) heat[wd][k] += m; });
    }
    const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
    const heatHtml = `<div class="tbl-wrap"><table class="heat hgrid"><thead><tr><th></th>${heat[0].map((_, k) => `<th>${oh + k}</th>`).join('')}</tr></thead><tbody>` +
      heat.map((row, wd) => `<tr><td>${WD[wd]}</td>${row.map(m => { const p = cnt[wd] ? m / (cnt[wd] * H.courts * 60) * 100 : 0; return `<td class="hc" style="--a:${Math.min(1, p / 100)}" title="${WD[wd]} ${pct0(p)}">${cnt[wd] ? de0.format(p) : ''}</td>`; }).join('')}</tr>`).join('') +
      '</tbody></table></div>';
    const since = H.since ? new Date(H.since + 'T12:00:00') : null;
    const missing = !since || since > weeks[0].start;
    host.innerHTML = head('Hallenauslastung', `Alle Belegungen aus eBuSy (Einzel- und Abobuchungen, auch von Externen, plus eigenes Training) auf ${H.courts} Plätzen, gezählt ${String(oh).padStart(2, '0')}–${Math.ceil(H.close / 60)} Uhr. 100 % = jede Stunde auf jedem Platz belegt.`) +
      `<section class="tiles">${tile('Diese Woche', W0.p, `ab ${fmtW(W0)}, inkl. schon gebuchter Tage${trainTxt(W0)}`, 'var(--accent)')}
        ${tile('Letzte Woche', Wm1.p, `ab ${fmtW(Wm1)}${trainTxt(Wm1)}`, 'var(--c-sonst)')}
        ${tile('Nächste Woche', Wp1.p, 'schon gebucht', 'var(--in)')}
        ${tile('Letzte 4 Wochen', l4n ? l4min / (l4n * cap) * 100 : null, `${de0.format(l4min / 60)} von ${de0.format(l4n * cap / 60)} Platzstunden${l4min ? ' · davon ' + de0.format(l4t / l4min * 100) + ' % Training' : ''}`, 'var(--c-pers)')}</section>
      <section class="panel"><div><h2>Auslastung je Woche</h2><p class="explain">Helle Säulen sind kommende Wochen: so viel ist schon gebucht.${missing ? ` eBuSy zeigt vergangene Tage nicht an. Die Belegung wird deshalb seit ${since ? since.toLocaleDateString('de-DE') : 'heute'} stündlich gespeichert, die Historie wächst ab dann.` : ''}</p></div><div class="chart" id="h-weeks"></div></section>
      <section class="panel"><div><h2>Wann ist die Halle voll?</h2><p class="explain">Durchschnittliche Belegung je Wochentag und Uhrzeit: letzte 8 Wochen und schon gebuchte kommende 2 Wochen, soweit gespeichert. Je dunkler, desto voller.</p></div>${heatHtml}</section>`;
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
      try { await load(true); draw(tab, company, host); } catch (e) { toast(e.message || 'Fehler'); }
    });
  }

  function reset() { data = null; loadedAt = 0; }

  return { render, configured, reset };
})();
