#!/usr/bin/env node
// Agenda Università – Pontivi · sincronizzazione dai calendari pubblici Cineca University Planner (Insubria)
// Uso: node sync.mjs <prev-data.json | -> <out-dir>
// Legge i 3 calendari pubblici con la stessa API usata dalla pagina ufficiale
// (POST /api/Impegni/getImpegniCalendarioPubblico), filtra il docente PONTIVI,
// unisce le partizioni svolte insieme, confronta con lo stato precedente e scrive out-dir/data.json.
// Nessuna dipendenza: usa curl (rispetta il proxy dell'ambiente).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://unins.prod.up.cineca.it';
const CLIENTE_ID = '59f05192a635f443422fe8fd'; // UNINS, da /api/Clienti/cercaPerDominio
const SURNAME = 'PONTIVI';
const SOURCES = [
  { id: '6a588a9f4737d600190c6e1a', name: 'Calendario 1' },
  { id: '6a589161be17f20034361fc6', name: 'Calendario 2' },
  { id: '6a5898010fc640018f92fece', name: 'Calendario 3' },
].map(s => ({ ...s, url: `${BASE}/calendarioPubblico/linkCalendarioId=${s.id}` }));
const HISTORY_MAX = 400;
const STATI = { P: 'programmata', C: 'programmata', B: 'programmata', A: 'annullata', S: 'sospesa', E: 'in_revisione', R: 'in_revisione' };

const [, , prevArg, outDir = 'out'] = process.argv;
const now = new Date();
const nowIso = now.toISOString();

function readPrev() {
  if (!prevArg || prevArg === '-' || !fs.existsSync(prevArg)) return null;
  const txt = fs.readFileSync(prevArg, 'utf8').trim();
  if (!txt) return null;
  const d = JSON.parse(txt); // se il JSON è rotto meglio fermarsi che perdere lo storico
  if (!Array.isArray(d.lessons)) throw new Error('data.json precedente senza "lessons"');
  return d;
}

function academicWindow(d) {
  const y = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; // da settembre
  return { from: `${y}-08-31T22:00:00.000Z`, to: `${y + 1}-09-30T21:59:59.000Z` };
}

function fetchSource(src, win) {
  if (process.env.SYNC_FIXTURES) { // solo per i test: legge risposte salvate su disco
    const f = path.join(process.env.SYNC_FIXTURES, `imp_${src.id}.json`);
    if (!fs.existsSync(f)) throw new Error('fixture mancante (simula fonte non raggiungibile)');
    return validate(JSON.parse(fs.readFileSync(f, 'utf8')));
  }
  const body = JSON.stringify({
    mostraImpegniAnnullati: true, mostraIndisponibilitaTotali: false,
    dataInizio: win.from, dataFine: win.to, linkCalendarioId: src.id, clienteId: CLIENTE_ID,
  });
  const out = execFileSync('curl', ['-sS', '--fail-with-body', '-m', '120', '--retry', '2', '--retry-delay', '5',
    '-X', 'POST', '-H', 'Content-Type: application/json', '-H', 'Accept: application/json',
    '-A', 'AgendaUniversitaPontivi/1.0 (sync ogni 6 ore)', '--data', body,
    `${BASE}/api/Impegni/getImpegniCalendarioPubblico`], { maxBuffer: 200 * 1024 * 1024, encoding: 'utf8' });
  return validate(JSON.parse(out));
}
function validate(data) {
  if (!Array.isArray(data)) throw new Error('Formato inatteso: la risposta non è un elenco');
  for (const i of data.slice(0, 5)) {
    for (const k of ['id', 'dataInizio', 'dataFine', 'nome', 'stato'])
      if (!(k in i)) throw new Error(`Formato cambiato: manca il campo "${k}"`);
  }
  return data;
}

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
const SMALL = new Set(['di', 'della', 'delle', 'dello', 'degli', 'dei', 'del', 'e', 'ed', 'per', 'in', 'a', 'da', 'la', 'il', 'le', 'lo', 'gli', 'con']);
function pretty(s) {
  let t = String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  t = t.replace(/(^|[\s'(-])([\p{L}])/gu, (m, p, c) => p + c.toUpperCase());
  t = t.split(' ').map((w, i) => (i > 0 && SMALL.has(w.toLowerCase()) ? w.toLowerCase() : w)).join(' ');
  t = t.replace(/\bMod\.\s*(\d)/g, 'Mod. $1').replace(/\bD'/g, "d'").replace(/'(\p{L})/gu, (m, c) => "'" + c.toUpperCase());
  t = t.replace(/(^|\s)d'(\p{L})/gu, (m, p, c) => p + "d'" + c.toUpperCase());
  return t.replace(/(\s)(Dell|Dall|Nell|Sull|All|Dell)'/g, (m, p, w) => p + w.toLowerCase() + "'");
}

function teachers(i) {
  const list = [...(i.docenti || []), ...(i.risorse || []).map(r => r.docente).filter(Boolean)];
  const seen = new Map();
  for (const d of list) {
    const key = norm(`${d.cognome} ${d.nome}`);
    if (d.cognome && !seen.has(key)) seen.set(key, d);
  }
  return [...seen.values()];
}
const isPontivi = i => teachers(i).some(d => new RegExp(`\\b${SURNAME}\\b`).test(norm(`${d.cognome} ${d.nome}`)));

function normalize(i, srcIdx) {
  const aule = (i.risorse || []).map(r => r.aula).filter(Boolean);
  const ed = aule.map(a => a.edificio).filter(Boolean)[0];
  const notes = [i.notePubbliche, i.notaSospensione].map(x => String(x ?? '').trim()).filter(Boolean)
    .map(n => (n === n.toUpperCase() ? n.charAt(0) + n.slice(1).toLowerCase() : n.charAt(0).toUpperCase() + n.slice(1)));
  const distanza = !aule.length && notes.some(n => /distanza|online|teams|remoto/i.test(n));
  const sedeDesc = (i.sedi || [])[0]?.descrizione || '';
  const citta = ed?.comune || (sedeDesc.match(/^(\w+)/) || [])[1] || '';
  return {
    id: i.id, src: srcIdx,
    start: new Date(i.dataInizio).toISOString(), end: new Date(i.dataFine).toISOString(),
    corso: pretty(i.nome), tipo: i.evento?.tipoAttivita?.descrizione || i.tipoAttivita?.descrizione || '',
    codice: i.codiceAttivita || '',
    cdl: (i.corsi || []).map(c => `${pretty(c.descrizione)} (${c.codice})`),
    part: (i.fattoreDiPartizione || []).flatMap(f => (f.partizioni || []).map(p => p.descrizione)).filter(Boolean),
    anno: i.annoCorso ?? null,
    aule: [...new Set(aule.map(a => a.descrizione.replace(/\s+/g, ' ').trim()))],
    edificio: ed?.descrizione || '', citta,
    indirizzo: ed ? [ed.via, ed.numeroCivico].filter(Boolean).join(' ') + (ed.comune ? `, ${ed.cap || ''} ${ed.comune}`.replace(/\s+/g, ' ') : '') : '',
    sede: distanza ? 'A distanza' : ed ? `${citta ? citta + ' · ' : ''}${ed.descrizione}` : (sedeDesc ? pretty(sedeDesc) : 'Da definire'),
    note: [...new Set(notes)], stato: STATI[i.stato] || 'programmata', statoCineca: i.stato,
    docenti: teachers(i).map(d => pretty(`${d.nome} ${d.cognome}`)),
    tele: i.linkTeledidattica || '', mod: i.dataModifica || i.dataCreazione || null,
  };
}

// Le partizioni (es. Cognomi A-G e H-Z) svolte nella stessa ora e aula diventano una lezione sola.
function group(items) {
  const byId = new Map();
  for (const it of items) {
    const ex = byId.get(it.id);
    if (ex) { ex.srcs.add(it.src); continue; }
    byId.set(it.id, { ...it, srcs: new Set([it.src]) });
  }
  const groups = new Map();
  for (const it of byId.values()) {
    const key = [it.start, it.end, norm(it.corso), it.stato, it.docenti.slice().sort().join(',')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  return [...groups.values()].map(list => {
    list.sort((a, b) => a.id.localeCompare(b.id));
    const f = list[0];
    const uniq = arr => [...new Set(arr)];
    return {
      ids: list.map(x => x.id), src: uniq(list.flatMap(x => [...x.srcs])).sort(),
      start: f.start, end: f.end, min: Math.round((new Date(f.end) - new Date(f.start)) / 60000),
      corso: f.corso, tipo: f.tipo, codice: uniq(list.map(x => x.codice).filter(Boolean)).join(', '),
      cdl: uniq(list.flatMap(x => x.cdl)), part: uniq(list.flatMap(x => x.part)), anno: f.anno,
      aule: uniq(list.flatMap(x => x.aule)), edificio: f.edificio, citta: f.citta, indirizzo: f.indirizzo,
      sede: f.sede, note: uniq(list.flatMap(x => x.note)), stato: f.stato, statoCineca: f.statoCineca,
      docenti: f.docenti, tele: uniq(list.map(x => x.tele).filter(Boolean))[0] || '',
      mod: list.map(x => x.mod).filter(Boolean).sort().pop() || null,
    };
  });
}

const FIELDS = { start: 'Inizio', end: 'Fine', aule: 'Aula', sede: 'Sede', stato: 'Stato', note: 'Note', corso: 'Insegnamento', tipo: 'Tipo' };
const val = (l, f) => (Array.isArray(l[f]) ? l[f].join(', ') : l[f] ?? '');

function merge(prev, groups, srcStatus, win) {
  const prevLessons = prev?.lessons || [];
  const prevByUid = new Map(prevLessons.map(l => [l.uid, l]));
  const idToUid = new Map();
  for (const l of prevLessons) for (const id of l.ids || []) idToUid.set(id, l.uid);
  const claimed = new Set();
  const history = [];
  const lessons = [];
  // abbinamento stabile: prima i gruppi che contengono l'id originale della uid
  const candidates = groups.map(g => ({ g, uids: [...new Set(g.ids.map(id => idToUid.get(id)).filter(Boolean))] }));
  candidates.sort((a, b) => (b.uids.includes('up-' + b.g.ids[0]) ? 1 : 0) - (a.uids.includes('up-' + a.g.ids[0]) ? 1 : 0));
  for (const { g, uids } of candidates) {
    let uid = uids.find(u => !claimed.has(u) && u === 'up-' + g.ids[0]) || uids.find(u => !claimed.has(u));
    if (!uid) { uid = 'up-' + g.ids[0]; let k = 2; while (claimed.has(uid) || (prevByUid.has(uid) && !uids.includes(uid))) uid = `up-${g.ids[0]}-${k++}`; }
    claimed.add(uid);
    const old = prevByUid.get(uid);
    const l = { uid, ...g, firstSeen: old?.firstSeen || nowIso, changedAt: old?.changedAt || null, changes: old?.changes || [] };
    if (!prev) { /* prima sincronizzazione: nessun confronto */ }
    else if (!old) {
      history.push({ at: nowIso, kind: 'aggiunta', uid, corso: l.corso, start: l.start, text: 'Nuova lezione pubblicata' });
      l.changedAt = nowIso; l.changes = [{ f: 'nuova', from: '', to: '' }];
    } else {
      const ch = Object.keys(FIELDS).filter(f => val(old, f) !== val(l, f))
        .map(f => ({ f, label: FIELDS[f], from: val(old, f), to: val(l, f) }));
      if (old.stato === 'rimossa') ch.push({ f: 'stato', label: 'Stato', from: 'rimossa', to: l.stato });
      if (ch.length) {
        const kind = l.stato === 'annullata' && old.stato !== 'annullata' ? 'annullata'
          : ch.some(c => c.f === 'start' || c.f === 'end') ? 'spostata' : ch.some(c => c.f === 'aule' || c.f === 'sede') ? 'cambio aula' : 'modificata';
        history.push({ at: nowIso, kind, uid, corso: l.corso, start: l.start, changes: ch });
        l.changedAt = nowIso; l.changes = ch;
      }
    }
    lessons.push(l);
  }
  // lezioni sparite: segnate "rimossa" solo se tutte le loro fonti hanno risposto in modo affidabile
  for (const old of prevLessons) {
    if (claimed.has(old.uid)) continue;
    const inWindow = old.start >= win.from && old.start <= win.to;
    const reliable = (old.src || []).every(s => srcStatus[s]?.ok && !srcStatus[s]?.suspicious);
    if (old.stato !== 'rimossa' && inWindow && reliable) {
      history.push({ at: nowIso, kind: 'rimossa', uid: old.uid, corso: old.corso, start: old.start, text: 'Non compare più nel calendario ufficiale' });
      lessons.push({ ...old, stato: 'rimossa', changedAt: nowIso, changes: [{ f: 'stato', label: 'Stato', from: old.stato, to: 'rimossa' }] });
    } else lessons.push(old);
  }
  lessons.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
  return { lessons, history };
}


// ---------- iCalendar (RFC 5545), orari in UTC, UID stabili ----------
const icsEsc = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = iso => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) {
  const out = []; let cur = '', bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function buildICS(lessons, includeCancelled, generatedAt) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Agenda Universita Pontivi//IT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Università – Pontivi', 'X-WR-TIMEZONE:Europe/Rome', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H'];
  for (const l of lessons) {
    const off = ['annullata', 'rimossa', 'sospesa'].includes(l.stato);
    if (off && !includeCancelled) continue;
    const desc = [l.tipo, l.cdl?.length ? 'Corso di laurea: ' + l.cdl.join('; ') : '', l.part?.length ? 'Partizioni: ' + l.part.join(', ') : '',
      ...(l.note || []).map(n => 'Nota: ' + n), off ? 'Stato: ' + l.stato.toUpperCase() : '', 'Fonte: ' + (SOURCES[l.src?.[0]]?.url || '')].filter(Boolean).join('\n');
    const seq = l.changedAt ? Math.max(0, Math.floor((new Date(l.changedAt) - new Date('2026-01-01')) / 60000)) : 0;
    L.push('BEGIN:VEVENT', `UID:${l.uid}@agenda-pontivi`, `DTSTAMP:${icsDate(generatedAt)}`, `DTSTART:${icsDate(l.start)}`, `DTEND:${icsDate(l.end)}`,
      `SUMMARY:${icsEsc((off ? 'ANNULLATA – ' : '') + l.corso + (l.tipo ? ' (' + l.tipo + ')' : ''))}`,
      `LOCATION:${icsEsc([l.aule?.join(', '), l.sede, l.indirizzo].filter(Boolean).join(' – '))}`,
      `DESCRIPTION:${icsEsc(desc)}`, `STATUS:${off ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${seq}`,
      `LAST-MODIFIED:${icsDate(l.changedAt || l.firstSeen || generatedAt)}`, `URL:${SOURCES[l.src?.[0]]?.url || BASE}`, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function main() {
  const prev = readPrev();
  const win = academicWindow(now);
  const srcStatus = {};
  const items = [];
  SOURCES.forEach((src, idx) => {
    const st = { idx, id: src.id, name: src.name, url: src.url, ok: false, fetchedAt: nowIso };
    try {
      const data = fetchSource(src, win);
      const mine = data.filter(isPontivi);
      st.ok = true; st.total = data.length; st.matched = mine.length;
      const prevFuture = (prev?.lessons || []).filter(l => (l.src || []).includes(idx) && l.stato !== 'rimossa' && l.start >= win.from && l.start <= win.to).length;
      if ((data.length === 0 || mine.length === 0) && prevFuture > 0) {
        st.suspicious = true; st.warning = data.length === 0 ? 'Il calendario è risultato vuoto: dati precedenti mantenuti' : 'Nessuna lezione Pontivi trovata, ma prima c\'erano: dati precedenti mantenuti';
      }
      for (const i of mine) items.push(normalize(i, idx));
    } catch (e) {
      st.error = String(e.stderr || e.message || e).slice(0, 300);
    }
    srcStatus[idx] = st;
    if (idx < SOURCES.length - 1 && !process.env.SYNC_FIXTURES) execFileSync('sleep', ['2']); // gentilezza verso il server
  });

  const okCount = Object.values(srcStatus).filter(s => s.ok).length;
  // le lezioni delle fonti fallite restano quelle precedenti
  const failed = new Set(Object.values(srcStatus).filter(s => !s.ok || s.suspicious).map(s => s.idx));
  const groups = group(items.filter(i => !failed.has(i.src)));
  const keepFromFailed = (prev?.lessons || []).filter(l => (l.src || []).some(s => failed.has(s)));
  const okIds = new Set(groups.flatMap(g => g.ids));
  const prevForMerge = prev ? { ...prev, lessons: prev.lessons.filter(l => !keepFromFailed.includes(l) || (l.ids || []).some(id => okIds.has(id))) } : null;
  const { lessons, history: newHist } = merge(prevForMerge, groups, srcStatus, win);
  for (const l of keepFromFailed) if (!lessons.some(x => x.uid === l.uid)) lessons.push({ ...l, stale: true });
  lessons.sort((a, b) => a.start.localeCompare(b.start));

  const allOk = okCount === SOURCES.length && !Object.values(srcStatus).some(s => s.suspicious);
  const prevStatus = prev?.status || {};
  const status = {
    lastAttempt: nowIso,
    lastSuccess: okCount > 0 ? nowIso : prevStatus.lastSuccess || null,
    lastFullSuccess: allOk ? nowIso : prevStatus.lastFullSuccess || null,
    ok: allOk, partial: okCount > 0 && !allOk,
    message: allOk ? 'Sincronizzazione completata' : okCount === 0 ? 'Nessun calendario raggiungibile: mostrati gli ultimi dati verificati' : 'Alcuni calendari non sono stati letti: per quelli restano gli ultimi dati verificati',
    sources: Object.values(srcStatus),
    runs: (prevStatus.runs || 0) + 1,
  };
  let history = prev?.history || [];
  if (!prev) history = [{ at: nowIso, kind: 'inizio', text: `Prima sincronizzazione: ${lessons.length} lezioni trovate` }];
  history = [...newHist, ...history].slice(0, HISTORY_MAX);

  const data = { version: 1, generatedAt: nowIso, timezone: 'Europe/Rome', teacher: 'Elisa Pontivi', window: win, status, lessons, history };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'data.json'), JSON.stringify(data));
  fs.writeFileSync(path.join(outDir, 'agenda.ics'), buildICS(lessons, false, nowIso));
  fs.writeFileSync(path.join(outDir, 'agenda-con-annullate.ics'), buildICS(lessons, true, nowIso));
  console.log(JSON.stringify({
    ok: status.ok, partial: status.partial, message: status.message,
    sources: status.sources.map(s => `${s.name}: ${s.ok ? `${s.total} impegni, ${s.matched} Pontivi` : 'ERRORE ' + s.error}${s.warning ? ' · ' + s.warning : ''}`),
    lessons: lessons.length, changes: newHist.length,
  }, null, 1));
}
main();
