// Test di scenario per sync.mjs: copie modificate delle risposte reali di Cineca.
// Uso: node test/run-tests.mjs <cartella-con-imp_*.json-reali>
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const REAL = process.argv[2];
const TMP = fs.mkdtempSync('/tmp/agenda-test-');
const SYNC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'sync.mjs');
const C1 = '6a588a9f4737d600190c6e1a', C2 = '6a589161be17f20034361fc6', C3 = '6a5898010fc640018f92fece';
const load = id => JSON.parse(fs.readFileSync(path.join(REAL, `imp_${id}.json`), 'utf8'));
const real = { [C1]: load(C1), [C2]: load(C2), [C3]: load(C3) };
let n = 0;
function run(name, fixtures, prev) {
  const dir = path.join(TMP, `${++n}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, data] of Object.entries(fixtures)) if (data) fs.writeFileSync(path.join(dir, `imp_${id}.json`), JSON.stringify(data));
  const prevFile = path.join(dir, 'prev.json');
  if (prev) fs.writeFileSync(prevFile, JSON.stringify(prev));
  execFileSync('node', [SYNC, prev ? prevFile : '-', path.join(dir, 'out')], { env: { ...process.env, SYNC_FIXTURES: dir }, encoding: 'utf8' });
  return JSON.parse(fs.readFileSync(path.join(dir, 'out', 'data.json'), 'utf8'));
}
const clone = x => JSON.parse(JSON.stringify(x));
const isP = i => JSON.stringify(i.docenti || []).includes('PONTIVI');
const ok = (m) => console.log('  ✓ ' + m);

// 1. prima sincronizzazione
const base = run('base', real);
assert.equal(base.lessons.length, 14); ok('14 lezioni dalle 20 righe Pontivi (partizioni unite)');
const allIds = base.lessons.flatMap(l => l.ids);
assert.equal(new Set(allIds).size, allIds.length); ok('nessun impegno Cineca duplicato');
assert.equal(new Set(base.lessons.map(l => l.uid)).size, base.lessons.length); ok('UID unici');
assert.ok(base.lessons.every(l => l.docenti.some(d => /Pontivi/.test(d)))); ok('solo lezioni con docente Pontivi');
assert.ok(base.status.ok && base.history[0].kind === 'inizio'); ok('stato OK e voce "prima sincronizzazione"');

// 2. stessa risposta: nessuna modifica
const same = run('same', real, base);
assert.equal(same.history.length, 1); assert.deepEqual(same.lessons.map(l => l.uid), base.lessons.map(l => l.uid)); ok('dati invariati: nessuna voce di storico, UID stabili');

// 3. orario spostato, aula cambiata, lezione annullata, lezione aggiunta, lezione rimossa
const m = clone(real);
const p1 = m[C1].filter(isP);
const target = p1.filter(i => i.dataInizio === '2026-11-27T14:00:00.000Z'); // coppia di partizioni
for (const i of target) { i.dataInizio = '2026-11-27T15:00:00.000Z'; i.dataFine = '2026-11-27T18:00:00.000Z'; }
const aulaT = p1.filter(i => i.dataInizio === '2026-12-11T14:00:00.000Z');
for (const i of aulaT) for (const r of i.risorse) if (r.aula) r.aula.descrizione = 'Aula 1 MTG';
const canc = m[C3].find(i => isP(i) && i.dataInizio === '2026-12-04T09:00:00.000Z'); canc.stato = 'A'; canc.notaSospensione = 'sospensione per prove parziali';
const added = clone(m[C3].find(i => isP(i))); added.id = 'ffffffffffffffffffffff01'; added.dataInizio = '2027-01-15T09:00:00.000Z'; added.dataFine = '2027-01-15T11:00:00.000Z'; m[C3].push(added);
m[C2] = m[C2].filter(i => !(isP(i) && i.dataInizio === '2026-11-23T16:30:00.000Z'));
const ch = run('changes', m, base);
const kinds = ch.history.filter(h => h.kind !== 'inizio').map(h => h.kind).sort();
assert.deepEqual(kinds, ['aggiunta', 'annullata', 'cambio aula', 'rimossa', 'spostata']); ok('rilevate: ' + kinds.join(', '));
const moved = ch.lessons.find(l => l.uid === base.lessons.find(b => b.start === '2026-11-27T14:00:00.000Z').uid);
assert.equal(moved.start, '2026-11-27T15:00:00.000Z'); ok('lezione spostata conserva la stessa UID (niente duplicati su iPhone)');
assert.equal(ch.lessons.length, 15); ok('totale 15 = 14 + 1 aggiunta (la rimossa resta visibile come "rimossa")');
assert.equal(ch.lessons.find(l => l.start === '2026-12-04T09:00:00.000Z').stato, 'annullata');
assert.equal(ch.lessons.find(l => l.start === '2026-11-23T16:30:00.000Z').stato, 'rimossa'); ok('stati annullata/rimossa corretti');

// 4. fonte non raggiungibile: restano gli ultimi dati verificati
const down = run('down', { [C1]: real[C1], [C2]: null, [C3]: real[C3] }, base);
assert.equal(down.status.ok, false); assert.equal(down.status.partial, true);
assert.equal(down.lessons.length, 14); assert.equal(down.lessons.filter(l => l.stato === 'rimossa').length, 0);
assert.ok(down.lessons.filter(l => l.src.includes(1)).every(l => l.stale)); ok('calendario 2 giù: nessuna cancellazione, lezioni segnate come non aggiornate');

// 5. tutte giù
const allDown = run('alldown', {}, base);
assert.equal(allDown.status.ok, false); assert.equal(allDown.status.lastSuccess, base.status.lastSuccess); assert.equal(allDown.lessons.length, 14);
ok('nessuna fonte: lastSuccess invariato, dati mantenuti');

// 6. risposta vuota sospetta (es. cambio formato)
const empty = run('empty', { [C1]: [], [C2]: real[C2], [C3]: real[C3] }, base);
assert.equal(empty.lessons.filter(l => l.stato === 'rimossa').length, 0); assert.ok(empty.status.sources[0].suspicious); ok('calendario vuoto trattato come sospetto, nessuna cancellazione');

// 7. formato cambiato
const broken = run('broken', { [C1]: { error: 'x' }, [C2]: real[C2], [C3]: real[C3] }, base);
assert.ok(!broken.status.sources[0].ok && /Formato/.test(broken.status.sources[0].error)); ok('formato inatteso riconosciuto come errore');

// 8. ritorno dopo guasto: nessun falso "aggiunta"
const back = run('back', real, down);
assert.equal(back.history.length, 1); assert.ok(back.lessons.every(l => !l.stale)); ok('dopo il guasto i dati tornano allineati senza falsi cambiamenti');

// 9. una partizione spostata da sola: si separa senza perdere la UID
const s = clone(real);
const one = s[C1].filter(isP).find(i => i.dataInizio === '2026-12-11T14:00:00.000Z' && i.id === '6aa92ffcd4326a0028c3cb14');
one.dataInizio = '2026-12-18T14:00:00.000Z'; one.dataFine = '2026-12-18T17:00:00.000Z';
const split = run('split', s, base);
const uidDec = base.lessons.find(l => l.start === '2026-12-11T14:00:00.000Z').uid;
assert.ok(split.lessons.some(l => l.uid === uidDec && l.start === '2026-12-11T14:00:00.000Z'));
assert.equal(new Set(split.lessons.map(l => l.uid)).size, split.lessons.length); ok('partizione spostata da sola: UID distinte, nessun duplicato');

console.log('\nTutti i test superati.');
