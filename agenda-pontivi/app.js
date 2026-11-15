// Agenda Università – Pontivi · interfaccia
const TZ = 'Europe/Rome';
const FEED = 'https://elisapontivi.github.io/agenda-pontivi/';
const SITE = FEED;
const ON_PAGES = location.hostname.endsWith('github.io');
const RUN_URL = 'https://github.com/elisapontivi/elisapontivi.github.io/actions/workflows/agenda-pontivi.yml';
const STALE_HOURS = 8; // oltre: la sincronizzazione automatica non sta rispondendo
const CHANGED_DAYS = 14;
const PALETTE = ['#2f6f62', '#c0613b', '#4f63c2', '#a7812f', '#8a4fae', '#2f86b0', '#b04772', '#5e7d2f'];
const FIXED = { 'mod. 1 economia industriale': 0, 'mod. 1 economia della tassazione': 1 };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('agp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('agp.' + k, JSON.stringify(v)); } catch { /* non disponibile */ } },
};

// ---------- date in fuso Europe/Rome ----------
const fmtCache = new Map();
function fmt(d, opts) {
  const key = JSON.stringify(opts);
  if (!fmtCache.has(key)) fmtCache.set(key, new Intl.DateTimeFormat('it-IT', { timeZone: TZ, ...opts }));
  return fmtCache.get(key).format(typeof d === 'string' ? new Date(d) : d);
}
const keyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayKey = d => keyFmt.format(typeof d === 'string' ? new Date(d) : d);
const kDate = k => new Date(k + 'T12:00:00Z');
const addDays = (k, n) => { const d = kDate(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = k => (kDate(k).getUTCDay() + 6) % 7; // 0 = lunedì
const mondayOf = k => addDays(k, -weekday(k));
const hm = iso => fmt(iso, { hour: '2-digit', minute: '2-digit' });
const longDay = k => fmt(kDate(k), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function hours(min) {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
function ago(iso) {
  if (!iso) return 'mai';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'pochi istanti fa';
  if (s < 3600) return `${Math.round(s / 60)} min fa`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h fa`;
  return `${Math.round(s / 86400)} giorni fa`;
}
function relDay(k) {
  const t = dayKey(new Date());
  const diff = Math.round((kDate(k) - kDate(t)) / 86400000);
  if (diff === 0) return 'oggi'; if (diff === 1) return 'domani'; if (diff === -1) return 'ieri';
  return diff > 0 ? `tra ${diff} giorni` : `${-diff} giorni fa`;
}

// ---------- stato ----------
const S = {
  data: null, lessons: [], conferme: store.get('conferme', {}), confSource: 'local',
  filters: store.get('filters', { corsi: [], sede: '', from: '', to: '' }),
  weekKey: null, monthKey: null, selDay: null, showPast: false, db: null, user: null, canWrite: true,
};
const colorOf = name => {
  const k = name.toLowerCase();
  if (k in FIXED) return PALETTE[FIXED[k]];
  let h = 0; for (const c of k) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[2 + (h % (PALETTE.length - 2))];
};
const conf = l => S.conferme[l.uid]?.stato || null;
const isOff = l => ['annullata', 'rimossa', 'sospesa'].includes(l.stato) || conf(l) === 'annullata';
const counts = l => !isOff(l) && l.stato !== 'in_revisione';
const isPast = l => new Date(l.end) < new Date();
const isNow = l => new Date(l.start) <= new Date() && new Date() <= new Date(l.end);
const recentlyChanged = l => l.changedAt && (Date.now() - new Date(l.changedAt)) < CHANGED_DAYS * 86400000 && l.changes?.length;
const sedeOf = l => l.sede || 'Da definire';

function filtered() {
  const f = S.filters;
  return S.lessons.filter(l =>
    (!f.corsi.length || f.corsi.includes(l.corso)) &&
    (!f.sede || sedeOf(l) === f.sede) &&
    (!f.from || dayKey(l.start) >= f.from) &&
    (!f.to || dayKey(l.start) <= f.to));
}
const activeFilters = () => (S.filters.corsi.length ? 1 : 0) + (S.filters.sede ? 1 : 0) + (S.filters.from || S.filters.to ? 1 : 0);

// ---------- componenti ----------
function tagsOf(l) {
  const t = [];
  const c = conf(l);
  if (l.stato === 'annullata') t.push('<span class="tag bad">Annullata da Cineca</span>');
  if (l.stato === 'rimossa') t.push('<span class="tag bad">Rimossa dal calendario</span>');
  if (l.stato === 'sospesa') t.push('<span class="tag bad">Sospesa</span>');
  if (l.stato === 'in_revisione') t.push('<span class="tag warn">In revisione</span>');
  if (c === 'annullata') t.push('<span class="tag bad">Segnata annullata</span>');
  if (c === 'svolta') t.push('<span class="tag ok">✓ Svolta</span>');
  if (!c && isPast(l) && counts(l)) t.push('<span class="tag info">Da confermare</span>');
  if (recentlyChanged(l) && l.stato !== 'rimossa' && l.stato !== 'annullata') t.push(`<span class="tag warn">${l.changes[0]?.f === 'nuova' ? 'Nuova' : 'Modificata'}</span>`);
  if (l.stale) t.push('<span class="tag warn">Non aggiornata</span>');
  if (isNow(l) && counts(l)) t.push('<span class="tag ok">In corso</span>');
  return t.join('');
}
function lessonRow(l, showDate = false) {
  const where = [l.aule?.length ? l.aule.join(', ') : '', sedeOf(l)].filter(Boolean).join(' · ');
  return `<button class="lesson ${isOff(l) ? 'x' : ''}" data-uid="${esc(l.uid)}" style="--c:${colorOf(l.corso)}">
    <span class="bar"></span>
    <span class="tm"><b>${hm(l.start)}</b><span>${hm(l.end)}</span></span>
    <span class="bd"><div class="nm">${esc(l.corso)}</div>
      <div class="mt">${showDate ? esc(cap(longDay(dayKey(l.start)))) + ' · ' : ''}${esc(l.tipo || 'Lezione')} · ${esc(hours(l.min))}</div>
      <div class="mt">${esc(where)}</div>
      <div class="tags">${tagsOf(l)}</div></span></button>`;
}
function dayList(list, emptyText = 'Nessuna lezione') {
  if (!list.length) return `<div class="empty">${emptyText}</div>`;
  const today = dayKey(new Date());
  const by = new Map();
  for (const l of list) { const k = dayKey(l.start); if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  return [...by].map(([k, ls]) => `<div class="daylabel ${k === today ? 'today' : ''}"><span>${esc(cap(longDay(k)))}</span><span>${esc(relDay(k))}</span></div><div class="stack">${ls.map(l => lessonRow(l)).join('')}</div>`).join('');
}
function filterBar() {
  const n = activeFilters();
  if (!n) return '';
  const parts = [];
  if (S.filters.corsi.length) parts.push(S.filters.corsi.join(', '));
  if (S.filters.sede) parts.push(S.filters.sede);
  if (S.filters.from || S.filters.to) parts.push(`${S.filters.from ? fmt(kDate(S.filters.from), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '…'} → ${S.filters.to ? fmt(kDate(S.filters.to), { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '…'}`);
  return `<div class="filterbar"><span>Filtri: ${esc(parts.join(' · '))}</span><button class="btn small" data-act="clearFilters">Rimuovi</button></div>`;
}

function syncInfo() {
  const st = S.data?.status || {};
  const ageH = st.lastAttempt ? (Date.now() - new Date(st.lastAttempt)) / 3600000 : Infinity;
  if (!S.data) return { cls: 'bad', title: 'Dati non disponibili', text: 'Non riesco a leggere i dati dell\'agenda.' };
  if (ageH > STALE_HOURS) return { cls: 'bad', title: 'La sincronizzazione automatica non risponde', text: `Ultimo tentativo ${ago(st.lastAttempt)} (ne è previsto uno ogni 6 ore). Vedi gli ultimi dati verificati, che potrebbero non essere aggiornati.` };
  if (!st.ok && !st.partial) return { cls: 'bad', title: 'Calendari Cineca non raggiungibili', text: `${st.message || ''}. Ultimo aggiornamento riuscito: ${st.lastSuccess ? fmt(st.lastSuccess, { dateStyle: 'medium', timeStyle: 'short' }) : 'mai'}.` };
  if (st.partial || !st.ok) {
    const bad = (st.sources || []).filter(s => !s.ok || s.suspicious).map(s => s.name).join(', ');
    return { cls: 'warn', title: 'Sincronizzazione parziale', text: `${bad}: ${st.message}. Le lezioni di quei calendari potrebbero non essere aggiornate.` };
  }
  return { cls: 'ok', title: 'Dati aggiornati', text: `Ultimo aggiornamento riuscito ${ago(st.lastSuccess)} (${fmt(st.lastSuccess, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}), dai 3 calendari ufficiali. Prossimo controllo automatico entro 6 ore.` };
}
const ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 8v5M12 16.5v.5"/><path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/></svg>',
};
ICONS.bad = ICONS.warn;
function statusCard() {
  const s = syncInfo();
  return `<div class="card status ${s.cls}"><div class="ic">${ICONS[s.cls]}</div><div><b>${esc(s.title)}</b><p>${esc(s.text)}</p></div></div>`;
}
function renderSyncLine() {
  const s = syncInfo();
  const st = S.data?.status;
  $('#syncLine').innerHTML = `<span class="dot ${s.cls}"></span><span>${s.cls === 'ok' ? 'Aggiornata ' + esc(ago(st.lastSuccess)) : esc(s.title)}</span>`;
}

// ---------- viste ----------
function viewHome() {
  const now = new Date();
  const list = filtered();
  const next = list.find(l => new Date(l.end) >= now && counts(l));
  const today = dayKey(now), mon = mondayOf(today), sun = addDays(mon, 6);
  const week = list.filter(l => { const k = dayKey(l.start); return k >= mon && k <= sun; });
  const hist = (S.data?.history || []).filter(h => h.kind !== 'inizio').slice(0, 4);
  const toConfirm = list.filter(l => isPast(l) && counts(l) && !conf(l)).length;
  let h = ON_PAGES ? '' : `<div class="filterbar"><span>Versione sempre aggiornata: <b>${SITE.replace('https://', '')}</b></span><a class="btn small" href="${SITE}" target="_blank" rel="noopener">Apri</a></div>`;
  h += filterBar();
  if (next) {
    const k = dayKey(next.start);
    h += `<div class="card hero" style="--c:${colorOf(next.corso)}"><div class="k">${isNow(next) ? 'Lezione in corso' : 'Prossima lezione'}</div>
      <div class="t">${esc(next.corso)}</div><div class="w">${esc(next.tipo || 'Lezione')} · ${esc(next.aule?.length ? next.aule.join(', ') + ' · ' : '')}${esc(sedeOf(next))}</div>
      <div class="when"><span class="pill">${esc(cap(longDay(k)))}</span><span class="pill">${hm(next.start)}–${hm(next.end)}</span><span class="pill">${esc(isNow(next) ? 'adesso' : relDay(k))}</span></div>
      <button data-uid="${esc(next.uid)}" aria-label="Dettagli"></button></div>`;
  } else h += `<div class="card"><b>Nessuna lezione futura in programma</b><p class="muted" style="margin:6px 0 0;font-size:14px">Non ci sono lezioni Pontivi future nei calendari ufficiali${activeFilters() ? ' con i filtri scelti' : ''}.</p></div>`;
  h += `<h2 class="sec">Questa settimana</h2><p class="faint" style="margin-top:-6px">${esc(fmt(kDate(mon), { day: 'numeric', month: 'long', timeZone: 'UTC' }))} – ${esc(fmt(kDate(sun), { day: 'numeric', month: 'long', timeZone: 'UTC' }))}</p>`;
  h += timeGrid(Array.from({ length: 7 }, (_, i) => addDays(mon, i)), list);
  if (!week.length) h += '<p class="faint" style="margin-top:8px">Nessuna lezione questa settimana.</p>';
  h += `<h2 class="sec">Aggiornamento</h2>${statusCard()}`;
  if (toConfirm) h += `<div class="card" style="margin-top:10px;display:flex;align-items:center;gap:12px"><div style="flex:1;font-size:14px"><b>${toConfirm} ${toConfirm === 1 ? 'lezione passata' : 'lezioni passate'} da confermare</b><div class="faint">Segna se le hai svolte, per il conteggio ore.</div></div><a class="btn small" href="#ore">Apri</a></div>`;
  if (hist.length) h += `<h2 class="sec">Ultime modifiche</h2><div class="card"><ul class="list">${hist.map(histItem).join('')}</ul><a class="btn small" style="margin-top:10px" href="#storico">Tutto lo storico</a></div>`;
  return h;
}
function histItem(e) {
  const when = `<div class="when">${esc(fmt(e.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${esc(e.kind)}</div>`;
  if (e.kind === 'inizio') return `<li>${when}${esc(e.text)}</li>`;
  const ch = (e.changes || []).map(c => `<div class="faint">${esc(c.label || c.f)}: <s>${esc(fmtVal(c.f, c.from))}</s> → ${esc(fmtVal(c.f, c.to))}</div>`).join('');
  return `<li>${when}<b>${esc(e.corso || '')}</b> del ${esc(e.start ? fmt(e.start, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '')}${e.text ? '<div class="faint">' + esc(e.text) + '</div>' : ''}${ch}</li>`;
}
function fmtVal(f, v) {
  if ((f === 'start' || f === 'end') && v) return fmt(v, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return v || '—';
}


// ---------- griglia oraria tipo agenda ----------
const minOfDay = iso => { const p = fmt(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':'); return +p[0] * 60 + +p[1]; };
const shortName = n => n.replace(/^Mod\.\s*\d+\s*/i, '').replace(/^Economia (della |dell'|delle |degli |del |di )?/i, 'Ec. ');
function timeGrid(keys, list, { day = false } = {}) {
  const hpx = day ? 64 : 46;
  const today = dayKey(new Date());
  const by = keys.map(k => list.filter(l => dayKey(l.start) === k));
  const all = by.flat();
  let h0 = 8, h1 = 20;
  for (const l of all) { h0 = Math.min(h0, Math.floor(minOfDay(l.start) / 60)); h1 = Math.max(h1, Math.ceil((minOfDay(l.start) + l.min) / 60)); }
  h1 = Math.min(24, h1);
  const H = (h1 - h0) * hpx;
  let h = `<div class="tg ${day ? 'day' : ''}" style="--cols:${keys.length};--hpx:${hpx}px"><div class="hd corner"></div>`;
  h += keys.map(k => `<div class="hd ${k === today ? 'today' : ''}">${esc(fmt(kDate(k), { weekday: 'short', timeZone: 'UTC' }).replace('.', ''))}<b>${Number(k.slice(8))}</b></div>`).join('');
  h += `<div class="hours" style="height:${H}px">${Array.from({ length: h1 - h0 }, (_, i) => i ? `<span style="top:${i * hpx}px">${String(h0 + i).padStart(2, '0')}</span>` : '').join('')}</div>`;
  keys.forEach((k, i) => {
    const ls = by[i].slice().sort((a, b) => a.start.localeCompare(b.start));
    // corsie per lezioni sovrapposte
    const lanes = []; const laneOf = new Map();
    for (const l of ls) { let j = lanes.findIndex(end => end <= l.start); if (j < 0) { j = lanes.length; lanes.push(''); } lanes[j] = l.end; laneOf.set(l, j); }
    const n = Math.max(1, lanes.length);
    const wd = weekday(k);
    h += `<div class="col ${k === today ? 'today' : ''} ${wd >= 5 ? 'we' : ''}" style="height:${H}px">`;
    for (const l of ls) {
      const top = (minOfDay(l.start) - h0 * 60) / 60 * hpx, ht = Math.max(l.min / 60 * hpx - 2, 22);
      const lane = laneOf.get(l), w = 100 / n;
      const where = l.aule?.length ? l.aule.join(', ') : sedeOf(l);
      h += `<button class="ev ${isOff(l) ? 'x' : ''} ${conf(l) === 'svolta' ? 'done' : ''}" data-uid="${esc(l.uid)}" style="--c:${colorOf(l.corso)};top:${top}px;height:${ht}px;${n > 1 ? `left:calc(${lane * w}% + 2px);right:auto;width:calc(${w}% - 4px)` : ''}">
        <b>${esc(day ? l.corso : shortName(l.corso))}</b><span class="s">${day ? hm(l.start) + '–' + hm(l.end) : hm(l.start)}</span>${day || ht > 110 ? `<div class="s">${esc(where)}</div>` : ''}${day ? `<div class="s">${esc(l.tipo || '')}${l.note?.length ? ' · ' + esc(l.note[0]) : ''}</div>` : ''}</button>`;
    }
    if (k === today) { const m = minOfDay(new Date().toISOString()); if (m >= h0 * 60 && m <= h1 * 60) h += `<div class="now" style="top:${(m - h0 * 60) / 60 * hpx}px"></div>`; }
    h += '</div>';
  });
  return h + '</div>';
}

function calSeg(on) {
  return `<div class="seg"><a href="#settimana" class="${on === 'settimana' ? 'on' : ''}">Settimana</a><a href="#oggi" class="${on === 'oggi' ? 'on' : ''}">Giorno</a><a href="#mese" class="${on === 'mese' ? 'on' : ''}">Mese</a></div>`;
}
function viewOggi() {
  const t = dayKey(new Date());
  if (!S.dayKey) S.dayKey = t;
  const k = S.dayKey;
  const list = filtered();
  const ls = list.filter(l => dayKey(l.start) === k);
  let h = calSeg('oggi') + filterBar();
  h += `<div class="navrow"><button class="iconbtn" data-act="dayNav" data-d="-1" aria-label="Giorno precedente">‹</button>
    <div class="ttl" style="text-align:center">${esc(longDay(k))}</div>
    <button class="iconbtn" data-act="dayNav" data-d="1" aria-label="Giorno successivo">›</button></div>`;
  if (k !== t) h += `<div style="text-align:center;margin:-4px 0 10px"><button class="btn small" data-act="dayToday">Torna a oggi</button></div>`;
  if (ls.length) h += timeGrid([k], list, { day: true });
  else {
    h += `<div class="empty">${k === t ? 'Oggi non hai lezioni all\'università.' : 'Nessuna lezione in questo giorno.'}</div>`;
    const next = list.find(l => dayKey(l.start) > k && counts(l));
    if (next) h += `<h3 class="small">Prossima</h3>${lessonRow(next, true)}<div style="margin-top:10px"><button class="btn small" data-act="dayGo" data-k="${dayKey(next.start)}">Vai a quel giorno</button></div>`;
  }
  return h;
}
function viewSettimana() {
  const t = dayKey(new Date());
  if (!S.weekKey) S.weekKey = mondayOf(t);
  const mon = S.weekKey, sun = addDays(mon, 6);
  const list = filtered();
  let h = calSeg('settimana') + filterBar();
  h += `<div class="navrow"><button class="iconbtn" data-act="week" data-d="-7" aria-label="Settimana precedente">‹</button>
    <div class="ttl" style="text-align:center">${esc(fmt(kDate(mon), { day: 'numeric', month: 'short', timeZone: 'UTC' }))} – ${esc(fmt(kDate(sun), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))}</div>
    <button class="iconbtn" data-act="week" data-d="7" aria-label="Settimana successiva">›</button></div>`;
  if (mon !== mondayOf(t)) h += `<div style="text-align:center;margin:-4px 0 8px"><button class="btn small" data-act="weekToday">Torna a questa settimana</button></div>`;
  const wk = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  const inWeek = list.filter(l => { const k = dayKey(l.start); return k >= mon && k <= sun; });
  const tot = inWeek.filter(counts).reduce((a, l) => a + l.min, 0);
  const mode = store.get('weekMode', 'griglia');
  h += `<div class="viewtoggle"><button class="btn small ${mode === 'griglia' ? 'primary' : ''}" data-act="weekMode" data-v="griglia">Agenda</button><button class="btn small ${mode === 'lista' ? 'primary' : ''}" data-act="weekMode" data-v="lista">Lista</button></div>`;
  if (mode === 'griglia') h += timeGrid(wk, list);
  else for (const k of wk) {
    const ls = list.filter(l => dayKey(l.start) === k);
    h += `<div class="daylabel ${k === t ? 'today' : ''}"><span>${esc(cap(fmt(kDate(k), { weekday: 'long', day: 'numeric', timeZone: 'UTC' })))}</span><span>${ls.length ? '' : '—'}</span></div>`;
    if (ls.length) h += `<div class="stack">${ls.map(l => lessonRow(l)).join('')}</div>`;
  }
  h += `<p class="faint" style="margin-top:16px">Ore programmate in questa settimana: <b>${hours(tot)}</b></p>`;
  return h;
}
function viewMese() {
  const t = dayKey(new Date());
  if (!S.monthKey) S.monthKey = t.slice(0, 7);
  const [y, m] = S.monthKey.split('-').map(Number);
  const first = `${S.monthKey}-01`;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = mondayOf(first);
  const list = filtered();
  const by = new Map();
  for (const l of list) { const k = dayKey(l.start); if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  if (!S.selDay || S.selDay.slice(0, 7) !== S.monthKey) S.selDay = t.slice(0, 7) === S.monthKey ? t : ([...by.keys()].find(k => k.startsWith(S.monthKey)) || first);
  let h = calSeg('mese') + filterBar();
  h += `<div class="navrow"><button class="iconbtn" data-act="month" data-d="-1" aria-label="Mese precedente">‹</button>
    <div class="ttl" style="text-align:center">${esc(fmt(kDate(first), { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</div>
    <button class="iconbtn" data-act="month" data-d="1" aria-label="Mese successivo">›</button></div><div class="month">`;
  h += ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => `<div class="wd">${d}</div>`).join('');
  const cells = Math.ceil((weekday(first) + days) / 7) * 7;
  for (let i = 0; i < cells; i++) {
    const k = addDays(start, i);
    const ls = by.get(k) || [];
    const cls = [k.slice(0, 7) !== S.monthKey ? 'out' : '', k === t ? 'today' : '', k === S.selDay ? 'sel' : ''].join(' ');
    h += `<button class="d ${cls}" data-act="day" data-k="${k}"><span>${Number(k.slice(8))}</span><span class="evs">${ls.slice(0, 3).map(l => `<i class="${isOff(l) ? 'x' : ''}" style="--c:${colorOf(l.corso)}"><b>${hm(l.start)}</b> ${esc(shortName(l.corso).split(' ').pop())}</i>`).join('')}${ls.length > 3 ? `<span class="more">+${ls.length - 3}</span>` : ''}</span></button>`;
  }
  h += '</div>';
  const sel = by.get(S.selDay) || [];
  h += `<div class="daylabel ${S.selDay === t ? 'today' : ''}" style="margin-top:18px"><span>${esc(cap(longDay(S.selDay)))}</span><span>${esc(relDay(S.selDay))}</span></div>`;
  h += sel.length ? `<div class="stack">${sel.map(l => lessonRow(l)).join('')}</div><div style="margin-top:10px"><button class="btn small" data-act="dayGo" data-k="${S.selDay}">Vedi il giorno in agenda</button></div>` : '<div class="empty">Nessuna lezione in questo giorno</div>';
  const corsi = [...new Set(list.map(l => l.corso))];
  h += `<div class="chips" style="margin-top:18px">${corsi.map(c => `<span class="chip" style="--c:${colorOf(c)}"><span class="sw"></span>${esc(c)}</span>`).join('')}</div>`;
  return h;
}
function viewElenco() {
  const now = new Date();
  const list = filtered();
  const shown = S.showPast ? list : list.filter(l => new Date(l.end) >= now);
  let h = `<h2 class="sec">${S.showPast ? 'Tutte le lezioni' : 'Prossime lezioni'}</h2>` + filterBar();
  h += `<div class="seg"><button class="${!S.showPast ? 'on' : ''}" data-act="past" data-v="0">Prossime</button><button class="${S.showPast ? 'on' : ''}" data-act="past" data-v="1">Tutte (anche passate)</button></div>`;
  if (!shown.length) return h + '<div class="empty">Nessuna lezione da mostrare</div>';
  let curM = '';
  for (const l of shown) {
    const mk = dayKey(l.start).slice(0, 7);
    if (mk !== curM) { curM = mk; h += `<h3 class="small">${esc(fmt(kDate(mk + '-15'), { month: 'long', year: 'numeric', timeZone: 'UTC' }))}</h3>`; }
    h += `<div style="margin-bottom:10px">${lessonRow(l, true)}</div>`;
  }
  return h;
}
function viewOre() {
  const list = filtered();
  const now = new Date();
  const cnt = list.filter(counts);
  const sum = a => a.reduce((s, l) => s + l.min, 0);
  const tot = sum(cnt), past = sum(cnt.filter(l => new Date(l.end) < now)), fut = tot - past;
  const done = sum(cnt.filter(l => conf(l) === 'svolta'));
  const pend = cnt.filter(l => new Date(l.end) < now && !conf(l));
  const off = sum(list.filter(isOff));
  let h = `<h2 class="sec">Riepilogo ore</h2>` + filterBar();
  h += `<div class="stats">
    <div class="stat big"><div><div class="v">${hours(tot)}</div><div class="l">Ore programmate complessive</div></div>
      <div class="progress" title="Svolte confermate / trascorse / da svolgere"><i style="width:${tot ? done / tot * 100 : 0}%;background:var(--ok)"></i><i style="width:${tot ? (past - done) / tot * 100 : 0}%;background:color-mix(in srgb,var(--ok) 35%,var(--bg2))"></i></div></div>
    <div class="stat"><div class="v">${hours(past)}</div><div class="l">Già trascorse (in calendario)</div></div>
    <div class="stat"><div class="v">${hours(fut)}</div><div class="l">Ancora da svolgere</div></div>
    <div class="stat"><div class="v" style="color:var(--ok)">${hours(done)}</div><div class="l">Svolte (confermate da te)</div></div>
    <div class="stat"><div class="v">${hours(off)}</div><div class="l">Annullate / rimosse (escluse)</div></div></div>`;
  h += `<p class="faint" style="margin-top:10px">Durata calcolata da ora di inizio e fine. Una lezione passata non è considerata svolta finché non la confermi.</p>`;
  if (pend.length) {
    h += `<h3 class="small">Da confermare (${pend.length})</h3><div class="stack">${pend.map(l => `<div class="card" style="padding:12px;display:flex;gap:10px;align-items:center;--c:${colorOf(l.corso)}"><span class="sw" style="height:34px;width:5px;border-radius:3px"></span><div style="flex:1;font-size:14px"><b>${esc(l.corso)}</b><div class="faint">${esc(fmt(l.start, { weekday: 'short', day: 'numeric', month: 'short' }))} · ${hm(l.start)}–${hm(l.end)} · ${hours(l.min)}</div></div>
      <button class="btn small primary" data-act="conf" data-uid="${esc(l.uid)}" data-v="svolta">Svolta</button><button class="btn small" data-act="conf" data-uid="${esc(l.uid)}" data-v="annullata">Annullata</button></div>`).join('')}</div>`;
  }
  const corsi = [...new Set(list.map(l => l.corso))];
  h += `<h3 class="small">Per insegnamento</h3><div class="stack">`;
  for (const c of corsi) {
    const ls = cnt.filter(l => l.corso === c);
    const p = sum(ls.filter(l => new Date(l.end) < now));
    h += `<div class="card cstat"><div class="hd"><span class="sw" style="--c:${colorOf(c)}"></span>${esc(c)}<span class="faint" style="margin-left:auto;font-weight:400">${ls.length} lezioni</span></div>
      <div class="g"><div><b>${hours(sum(ls))}</b>programmate</div><div><b>${hours(p)}</b>trascorse</div><div><b style="color:var(--ok)">${hours(sum(ls.filter(l => conf(l) === 'svolta')))}</b>svolte</div><div><b>${hours(sum(ls) - p)}</b>da svolgere</div></div></div>`;
  }
  h += '</div>';
  const months = new Map();
  for (const l of cnt) { const k = dayKey(l.start).slice(0, 7); months.set(k, (months.get(k) || 0) + l.min); }
  const max = Math.max(1, ...months.values());
  h += `<h3 class="small">Per mese</h3><div class="card">${[...months].sort().map(([k, v]) => `<div class="mbar"><span class="ml">${esc(fmt(kDate(k + '-15'), { month: 'short', year: '2-digit', timeZone: 'UTC' }))}</span><div class="progress"><i style="width:${v / max * 100}%;background:var(--accent)"></i></div><span class="mv">${hours(v)}</span></div>`).join('') || '<div class="faint">Nessun dato</div>'}</div>`;
  h += `<p class="faint" style="margin-top:12px">${S.confSource === 'db' ? 'Le conferme sono salvate nell\'agenda e si vedono da tutti i tuoi dispositivi.' : 'Le conferme sono salvate solo in questo browser.'}</p>`;
  return h;
}
function viewAltro() {
  const st = S.data?.status || {};
  let h = `<h2 class="sec">Calendario iPhone</h2><div class="card stack">
    <p style="margin:0;font-size:14px;line-height:1.5"><b>Sottoscrizione automatica (consigliata).</b> L'iPhone riceve da solo nuove lezioni, spostamenti, cambi d'aula e annullamenti.</p>
    <ol class="steps"><li>Copia l'indirizzo qui sotto.</li><li>Apri <b>Impostazioni → App → Calendario → Account calendario → Aggiungi account → Altro → Aggiungi calendario sottoscritto</b>.</li><li>Incolla l'indirizzo e tocca <b>Avanti</b>, poi <b>Salva</b>.</li></ol>
    <code id="feedUrl">${FEED}agenda.ics</code>
    <div class="actions"><button class="btn primary" data-act="copyFeed">Copia indirizzo</button><a class="btn" href="webcal://elisapontivi.github.io/agenda-pontivi/agenda.ics">Apri in Calendario</a></div>
    <div class="note">Il server rigenera il file ogni 6 ore. Con quale frequenza l'iPhone lo rilegge dipende da Calendario di Apple: di solito da 15 minuti a qualche ora, e puoi sceglierlo in <b>Calendario → Account → Recupera</b>. Ogni lezione ha un identificativo stabile, quindi una lezione spostata viene aggiornata, non duplicata.</div>
    <p style="margin:6px 0 0;font-size:14px"><b>Download una tantum:</b> <a href="${FEED}agenda.ics" target="_blank" rel="noopener">agenda.ics</a> · <a href="${FEED}agenda-con-annullate.ics" target="_blank" rel="noopener">con le annullate</a></p></div>`;
  h += ON_PAGES
    ? `<h2 class="sec">Sulla schermata Home</h2><div class="card"><ol class="steps"><li>Apri questa pagina in <b>Safari</b>.</li><li>Tocca <b>Condividi</b> (il quadrato con la freccia).</li><li>Scegli <b>Aggiungi alla schermata Home</b> e conferma.</li></ol><p class="faint" style="margin:0">L'agenda si apre a schermo intero come un'app e, senza rete, mostra gli ultimi dati scaricati.</p></div>`
    : `<h2 class="sec">Sito sempre aggiornato</h2><div class="card"><p style="margin:0 0 10px;font-size:14px">La versione aggiornata in automatico ogni 6 ore è su GitHub. Aprila in Safari e aggiungila alla schermata Home.</p><a class="btn primary" href="${SITE}" target="_blank" rel="noopener">Apri ${SITE.replace('https://', '')}</a></div>`;
  h += `<h2 class="sec">Fonti e sincronizzazione</h2>${statusCard()}<div class="card" style="margin-top:10px"><ul class="list">${(st.sources || []).map(s => `<li><b>${esc(s.name)}</b> <span class="tag ${s.ok && !s.suspicious ? 'ok' : 'bad'}">${s.ok && !s.suspicious ? 'OK' : 'Problema'}</span><div class="faint">${s.ok ? `${s.total} impegni letti, ${s.matched} con docente Pontivi` : esc(s.error || '')}${s.warning ? ' · ' + esc(s.warning) : ''}</div><a href="${esc(s.url)}" target="_blank" rel="noopener" style="font-size:13px">Apri il calendario ufficiale</a></li>`).join('')}</ul>
    <p class="faint">Ultimo tentativo: ${st.lastAttempt ? esc(fmt(st.lastAttempt, { dateStyle: 'medium', timeStyle: 'short' })) : '—'} · sincronizzazioni eseguite: ${st.runs || 0}</p></div>`;
  h += `<div class="note" style="margin-top:10px">Ogni 6 ore un job sul server (GitHub Actions) legge i 3 calendari pubblici Cineca University Planner dell'Insubria e tiene solo gli impegni con docente Pontivi, anche come co-docente. Le partizioni (es. Cognomi A-G / H-Z) svolte insieme diventano una lezione sola. Se un calendario non risponde, restano visibili gli ultimi dati verificati e nessuna lezione viene cancellata.</div>`;
  h += `<h2 class="sec">Aspetto</h2><div class="seg">${['auto', 'chiaro', 'scuro'].map(t => `<button data-act="theme" data-v="${t}" class="${(store.get('theme', 'auto')) === t ? 'on' : ''}">${cap(t)}</button>`).join('')}</div>`;
  h += `<h2 class="sec">Storico modifiche</h2><a class="btn" href="#storico">Apri lo storico (${(S.data?.history || []).length})</a>`;
  h += `<h2 class="sec">Privacy</h2><div class="note">${ON_PAGES ? 'La pagina contiene soltanto dati già pubblici sui calendari dell\'università ed è esclusa dai motori di ricerca (noindex), ma chi conosce l\'indirizzo può aprirla. Le tue conferme "svolta/annullata" restano solo su questo dispositivo.' : 'Questo artifact è privato: lo vede solo chi ha accesso. Contiene soltanto dati già pubblici sui calendari dell\'università.'}</div>`;
  return h;
}
function viewStorico() {
  const hist = S.data?.history || [];
  return `<h2 class="sec">Storico modifiche</h2><p class="faint" style="margin-top:-6px">Differenze rilevate tra una sincronizzazione e la successiva.</p><div class="card"><ul class="list">${hist.map(histItem).join('') || '<li>Nessuna modifica registrata</li>'}</ul></div>`;
}

// ---------- dettaglio ----------
function openLesson(uid) {
  const l = S.lessons.find(x => x.uid === uid);
  if (!l) return;
  const k = dayKey(l.start), c = conf(l);
  const src = (S.data.status.sources || []);
  let h = `<div style="display:flex;align-items:center;gap:8px;margin-top:4px"><span class="sw" style="--c:${colorOf(l.corso)};width:12px;height:12px"></span><span class="faint">${esc(l.tipo || 'Lezione')}${l.codice ? ' · ' + esc(l.codice) : ''}</span></div>
    <h2>${esc(l.corso)}</h2><div class="tags" style="display:flex;gap:5px;flex-wrap:wrap">${tagsOf(l)}</div>
    <dl class="kv"><dt>Data</dt><dd>${esc(cap(longDay(k)))}</dd>
    <dt>Orario</dt><dd>${hm(l.start)} – ${hm(l.end)} <span class="faint">(${hours(l.min)})</span></dd>
    <dt>Sede</dt><dd>${esc(sedeOf(l))}${l.indirizzo ? `<div class="faint">${esc(l.indirizzo)}</div>` : ''}</dd>
    <dt>Aula</dt><dd>${esc(l.aule?.length ? l.aule.join(', ') : '—')}</dd>
    <dt>Corso di laurea</dt><dd>${esc(l.cdl?.join('; ') || '—')}${l.anno ? `<div class="faint">${esc(l.anno)}° anno</div>` : ''}</dd>
    ${l.part?.length ? `<dt>Partizioni</dt><dd>${esc(l.part.join(', '))}</dd>` : ''}
    <dt>Docenti</dt><dd>${esc(l.docenti?.join(', ') || '—')}</dd>
    ${l.note?.length ? `<dt>Note</dt><dd>${esc(l.note.join(' · '))}</dd>` : ''}
    ${l.tele ? `<dt>Online</dt><dd><a href="${esc(l.tele)}" target="_blank" rel="noopener">Link teledidattica</a></dd>` : ''}
    <dt>Fonte</dt><dd>${(l.src || []).map(i => src[i] ? `<a href="${esc(src[i].url)}" target="_blank" rel="noopener">${esc(src[i].name)}</a>` : '').join(', ')}<div class="faint">Modificata su Cineca: ${l.mod ? esc(fmt(l.mod, { dateStyle: 'medium', timeStyle: 'short' })) : '—'}</div></dd></dl>`;
  if (l.changes?.length && l.changedAt) {
    h += `<h3 class="small">Ultima modifica rilevata · ${esc(fmt(l.changedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</h3>`;
    h += l.changes.map(ch => ch.f === 'nuova' ? '<div class="chg">Lezione nuova, comparsa dopo la prima sincronizzazione</div>' : `<div class="chg">${esc(ch.label || ch.f)}: <s>${esc(fmtVal(ch.f, ch.from))}</s> → <b>${esc(fmtVal(ch.f, ch.to))}</b></div>`).join('');
  }
  h += `<h3 class="small">Registro personale</h3>`;
  if (!S.canWrite) h += '<p class="faint">Solo la proprietaria dell\'agenda può confermare le lezioni.</p>';
  else h += `<div class="actions"><button class="btn ${c === 'svolta' ? 'primary' : ''}" data-act="conf" data-uid="${esc(l.uid)}" data-v="svolta">✓ Svolta</button>
    <button class="btn ${c === 'annullata' ? 'primary' : ''}" data-act="conf" data-uid="${esc(l.uid)}" data-v="annullata">Annullata</button>
    ${c ? `<button class="btn" data-act="conf" data-uid="${esc(l.uid)}" data-v="">Annulla scelta</button>` : ''}</div>
    <p class="faint">${isPast(l) ? '' : 'Lezione futura: puoi segnarla in anticipo come annullata. '}Le conferme valgono solo per il conteggio ore e non modificano il calendario ufficiale.</p>`;
  openSheet(h);
}
function openFilters() {
  const corsi = [...new Set(S.lessons.map(l => l.corso))];
  const sedi = [...new Set(S.lessons.map(sedeOf))].sort();
  const f = S.filters;
  openSheet(`<h2>Filtri</h2><h3 class="small">Insegnamento</h3><div class="chips">${corsi.map(c => `<button class="chip ${f.corsi.includes(c) ? 'on' : ''}" style="--c:${colorOf(c)}" data-act="fcorso" data-v="${esc(c)}"><span class="sw"></span>${esc(c)}</button>`).join('')}</div>
    <h3 class="small">Sede</h3><label class="field"><select id="fSede"><option value="">Tutte le sedi</option>${sedi.map(s => `<option ${f.sede === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
    <h3 class="small">Periodo</h3><div class="row"><label class="field">Dal<input type="date" id="fFrom" value="${esc(f.from)}"></label><label class="field">Al<input type="date" id="fTo" value="${esc(f.to)}"></label></div>
    <div class="chips" style="margin-top:10px"><button class="chip" data-act="fper" data-v="month">Questo mese</button><button class="chip" data-act="fper" data-v="sem">Fino a fine anno</button><button class="chip" data-act="fper" data-v="fut">Da oggi</button></div>
    <div class="actions" style="margin-top:20px"><button class="btn primary" data-act="fapply">Applica</button><button class="btn" data-act="clearFilters">Azzera</button></div>`);
}
function openRefresh() {
  const st = S.data?.status || {};
  openSheet(`<h2>Aggiorna ora</h2><p style="font-size:14px;line-height:1.5">Ho ricaricato i dati. Ultimo controllo dei calendari Cineca: <b>${st.lastAttempt ? esc(fmt(st.lastAttempt, { weekday: 'long', hour: '2-digit', minute: '2-digit' })) : '—'}</b> (${esc(ago(st.lastAttempt))}). Il controllo è automatico ogni 6 ore.</p>
    <h3 class="small">Per forzare un controllo subito</h3>
    <ol class="steps"><li>Apri la pagina della sincronizzazione su GitHub (devi aver fatto l'accesso a GitHub).</li><li>Tocca <b>Run workflow</b>, poi di nuovo <b>Run workflow</b>.</li><li>Dopo 1–2 minuti tocca di nuovo ↻ qui${ON_PAGES ? '' : ' (o apri il sito su GitHub)'}.</li></ol>
    <div class="actions"><a class="btn primary" href="${RUN_URL}" target="_blank" rel="noopener">Apri la sincronizzazione</a><a class="btn" href="${esc((st.sources || [])[0]?.url || '#')}" target="_blank" rel="noopener">Calendario Cineca</a></div>`);
}
function openSheet(html) { $('#sheetBody').innerHTML = html; $('#sheet').classList.add('on'); $('#scrim').classList.add('on'); $('#sheet').scrollTop = 0; }
function closeSheet() { $('#sheet').classList.remove('on'); $('#scrim').classList.remove('on'); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 2600); }

// ---------- conferme (database dell'artifact, con ripiego locale) ----------
async function setConf(uid, v) {
  const prev = S.conferme[uid];
  if (v) S.conferme[uid] = { stato: v, at: new Date().toISOString() }; else delete S.conferme[uid];
  render();
  if (S.db && S.confSource === 'db') {
    try { const ref = S.db.doc('conferme/' + uid); if (v) await ref.set(S.conferme[uid]); else await ref.delete(); }
    catch (e) {
      if (prev) S.conferme[uid] = prev; else delete S.conferme[uid];
      if (e?.code === 'invalid_argument') S.canWrite = false;
      toast('Conferma non salvata: ' + (e?.code || 'errore')); render(); return;
    }
  } else store.set('conferme', S.conferme);
  toast(v === 'svolta' ? 'Segnata come svolta' : v === 'annullata' ? 'Segnata come annullata' : 'Scelta rimossa');
}
async function initDb() {
  try {
    if (!window.claude?.use) return;
    const db = await window.claude.use('db');
    if (!db) return;
    S.db = db;
    const user = await window.claude.use('user').catch(() => null);
    if (user?.can) { const w = await user.can('data.write').catch(() => null); if (w === false) S.canWrite = false; }
    const local = store.get('conferme', {});
    db.collection('conferme').onSnapshot(snap => {
      const next = {};
      for (const d of snap.docs) next[d.id] = d.data();
      S.conferme = next; S.confSource = 'db';
      // porta nel database eventuali conferme fatte prima solo in locale
      for (const [uid, v] of Object.entries(local)) if (!next[uid] && S.canWrite) { db.doc('conferme/' + uid).set(v).catch(() => {}); delete local[uid]; store.set('conferme', local); }
      if (!$('#sheet').classList.contains('on')) render();
    }, () => { S.confSource = 'local'; });
  } catch { /* resta il salvataggio locale */ }
}

// ---------- router e caricamento ----------
const ROUTES = { home: viewHome, oggi: viewOggi, settimana: viewSettimana, mese: viewMese, elenco: viewElenco, ore: viewOre, altro: viewAltro, storico: viewStorico };
const TAB = { home: 'home', oggi: 'cal', settimana: 'cal', mese: 'cal', elenco: 'elenco', ore: 'ore', altro: 'altro', storico: 'altro' };
const route = () => (location.hash.slice(1) in ROUTES ? location.hash.slice(1) : 'home');
function render() {
  if (!S.data) return;
  const r = route();
  $('#view').innerHTML = ROUTES[r]();
  document.querySelectorAll('nav.tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === TAB[r]));
  const n = activeFilters();
  $('#filterCount').hidden = !n; $('#filterCount').textContent = n;
  renderSyncLine();
}
async function load(manual = false) {
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch('data.json?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
    clearTimeout(tm);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    S.data = await r.json();
    S.lessons = S.data.lessons || [];
    render();
    if (manual) openRefresh();
  } catch (e) {
    if (!S.data) $('#view').innerHTML = `<div class="card status bad" style="margin-top:20px"><div class="ic">${ICONS.bad}</div><div><b>Non riesco a caricare l'agenda</b><p>${esc(e.message)}. Riprova tra poco.</p></div></div>`;
    else toast('Ricarica non riuscita: restano i dati già mostrati');
  }
}
function applyTheme() {
  const t = store.get('theme', 'auto');
  const dark = t === 'scuro' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]').content = dark ? '#121418' : '#f6f3ec';
}

document.addEventListener('click', e => {
  const u = e.target.closest('[data-uid]:not([data-act])');
  if (u) { openLesson(u.dataset.uid); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const v = a.dataset.v;
  switch (a.dataset.act) {
    case 'week': S.weekKey = addDays(S.weekKey, Number(a.dataset.d)); render(); break;
    case 'weekToday': S.weekKey = null; render(); break;
    case 'weekMode': store.set('weekMode', v); render(); break;
    case 'dayNav': S.dayKey = addDays(S.dayKey, Number(a.dataset.d)); render(); break;
    case 'dayToday': S.dayKey = null; render(); break;
    case 'dayGo': S.dayKey = a.dataset.k; if (location.hash !== '#oggi') location.hash = 'oggi'; else render(); break;
    case 'month': { const [y, m] = S.monthKey.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + Number(a.dataset.d), 1)); S.monthKey = d.toISOString().slice(0, 7); render(); break; }
    case 'day': S.selDay = a.dataset.k; if (S.selDay.slice(0, 7) !== S.monthKey) S.monthKey = S.selDay.slice(0, 7); render(); break;
    case 'past': S.showPast = v === '1'; render(); break;
    case 'conf': setConf(a.dataset.uid, v).then(() => { if ($('#sheet').classList.contains('on') && $('#sheetBody h2')?.textContent !== 'Filtri') openLesson(a.dataset.uid); }); break;
    case 'copyFeed':
      navigator.clipboard?.writeText(FEED + 'agenda.ics').then(() => toast('Indirizzo copiato'), () => toast('Copia non riuscita: tieni premuto sull\'indirizzo'));
      break;
    case 'theme': store.set('theme', v); applyTheme(); render(); break;
    case 'fcorso': a.classList.toggle('on'); break;
    case 'fper': {
      const t = dayKey(new Date());
      if (v === 'month') { $('#fFrom').value = t.slice(0, 7) + '-01'; $('#fTo').value = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7), 0)).toISOString().slice(0, 10); }
      if (v === 'sem') { $('#fFrom').value = t; $('#fTo').value = t.slice(0, 4) + '-12-31'; }
      if (v === 'fut') { $('#fFrom').value = t; $('#fTo').value = ''; }
      break;
    }
    case 'fapply':
      S.filters = { corsi: [...document.querySelectorAll('[data-act=fcorso].on')].map(b => b.dataset.v), sede: $('#fSede').value, from: $('#fFrom').value, to: $('#fTo').value };
      store.set('filters', S.filters); closeSheet(); render(); break;
    case 'clearFilters': S.filters = { corsi: [], sede: '', from: '', to: '' }; store.set('filters', S.filters); closeSheet(); render(); break;
  }
});
$('#btnFilter').onclick = openFilters;
$('#btnRefresh').onclick = () => load(true);
$('#sheetClose').onclick = closeSheet;
$('#scrim').onclick = closeSheet;
addEventListener('hashchange', () => { closeSheet(); render(); scrollTo(0, 0); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data && Date.now() - new Date(S.data.generatedAt) > 3600000) load(); });
applyTheme();
load();
if (ON_PAGES && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
initDb();
setInterval(() => { if (S.data) renderSyncLine(); }, 60000);
