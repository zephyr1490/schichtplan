import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { createDb } from './src/db.js';
import { turnusImportieren, planErzeugen, eintragSetzen, nrvSetzen, wrAnteil, bazSumme, zeitenVorschlag } from './src/dienstplan.js';
import { hhmm, TAGE, wochentag } from './src/zeit.js';

const db = createDb('test');
const ok = (bed, text) => { console.log(`${bed ? 'OK    ' : 'FEHLER'} ${text}`); if (!bed) process.exitCode = 1; };

const r = await turnusImportieren(db, fs.readFileSync('daten/turnus_schichten.csv', 'utf8'), fs.readFileSync('daten/turnus_wochenruhe.csv', 'utf8'), '2026-12-13');
console.log('Turnus geladen:', r);
console.log('Plan erzeugt:', await planErzeugen(db, '2026-12-14', 27));

// 1) Montag 14.12.2026 = 10007, 05:56-17:54
const t1 = await db.eintraege.get('2026-12-14');
ok(t1.code === '10007' && t1.beginn === '05:56' && t1.ende === '17:54', `14.12.2026 (${TAGE[wochentag('2026-12-14')]}) = ${t1.code} ${t1.beginn}-${t1.ende}, bAZ ${t1.baz}`);

// 2) Wochensummen müssen zu den gedruckten WoNAz-Werten passen (Turnus-Wochen 27 und 28)
const s27 = await bazSumme(db, '2026-12-14', '2026-12-20');
const s28 = await bazSumme(db, '2026-12-21', '2026-12-27');
ok(hhmm(s27) === '38:26', `Woche 27 bAZ-Summe = ${hhmm(s27)} (gedruckt 38:26)`);
ok(hhmm(s28) === '41:58', `Woche 28 bAZ-Summe = ${hhmm(s28)} (gedruckt 41:58)`);

// 3) Nach Woche 31 geht es mit Woche 1 weiter (Wochenende 14.12.2026 + 4 Wochen = Woche 31 -> Woche 1)
const w1 = await db.eintraege.get('2027-01-18'); // Montag Turnus-Woche 1
ok(w1.turnusWoche === 1 && w1.code === '10001', `18.01.2027 = Turnus-Woche ${w1.turnusWoche}, ${w1.code}`);

// 4) Zusatzdienst in der WR: Sonntag 20.12.2026 liegt in der WR (Sa 19.12. 17:29 - Mo 21.12. 05:29)
const z = await eintragSetzen(db, '2026-12-20', { code: '10004', beginn: '10:00', ende: '14:33', baz: '4:03', kategorie: 'zusatzschicht' });
const a = await wrAnteil(db, '2026-12-20');
console.log('Zusatzdienst So 20.12. 10:00-14:33 ->', a.text);
ok(a.inWr === 273 && a.ausserhalb === 0, 'komplett in der WR: 4:33h');

// 5) Teilweise in der WR: Dienst am Montag 21.12. ab 04:00 statt 05:29 (WR endet 05:29)
const alt = await db.eintraege.get('2026-12-21');
await eintragSetzen(db, '2026-12-21', { code: alt.code, beginn: '04:00', ende: alt.ende, baz: alt.baz, kategorie: 'aenderung' });
const b = await wrAnteil(db, '2026-12-21');
console.log(`Mo 21.12. ${alt.code} jetzt 04:00-${alt.ende} ->`, b.text, `(gesamt ${hhmm(b.gesamt)}, außerhalb ${hhmm(b.ausserhalb)})`);
ok(b.inWr === 89, 'teilweise in der WR: 1:29h');

// 6) NRV setzen + Historie: append-only, volle Kette
await nrvSetzen(db, '2026-12-21', true);
const hist = await db.aenderungen.where('datum').equals('2026-12-21').toArray();
console.log('Historie 21.12.:'); for (const h of hist) console.log(`  #${h.id} alt=${h.alt.beginn}-${h.alt.ende} neu=${h.neu.beginn}-${h.neu.ende} NRV=${h.nrv}`);
ok(hist.length === 2 && hist[0].alt.beginn === '05:29' && hist[1].alt.beginn === '04:00', 'Historie hat 2 Einträge, Kette lückenlos');

// 7) Vorschlag: eigenen Dienst eintragen -> Zeiten werden aus Schicht+Wochentag übernommen
const v = await zeitenVorschlag(db, '10003', '2026-12-26'); // Samstag
ok(v?.ende === '17:16', `Vorschlag 10003 am Samstag = ${v.beginn}-${v.ende}`);
const vn = await zeitenVorschlag(db, '10001', '2026-12-26');
ok(vn === null, '10001 am Samstag: kein Vorschlag (kommt im Turnus nicht vor) -> selbst eintragen');

// 8) Plan umfasst ein Jahr: zweiter Durchlauf: 23.08.2027 = wieder Turnus-Woche 1, letzter Tag 12.12.2027
const w32 = await db.eintraege.get('2027-08-23');
ok(w32.turnusWoche === 1 && w32.code === '10001', `23.08.2027 = Turnus-Woche ${w32.turnusWoche}, ${w32.code}`);
const letzter = (await db.eintraege.orderBy('datum').last()).datum;
console.log('Letzter Dienst im Plan:', letzter, '| Einträge gesamt:', await db.eintraege.count());
ok(letzter <= '2027-12-12', 'Plan endet spätestens am 12.12.2027');
