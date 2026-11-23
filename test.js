import 'fake-indexeddb/auto';
import fs from 'node:fs';
import { createDb } from './src/db.js';
import { wrVersetzen, historieEintragLoeschen, wochenruhenFuerTag, folgetagKonflikt, planZuruecksetzen, allesLoeschen, turnusImportieren, planErzeugen, eintragSetzen, eintragLoeschen, historie, nrvSetzen, wrAnteil, bazSumme, zeitenVorschlag } from './src/dienstplan.js';
import { hhmm, TAGE, wochentag, addTage, minuten } from './src/zeit.js';
import { auswertung, auswertungDrz, auswertungWochen, wochenMontage, zeitraumFuer } from './src/auswertung.js';

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

// 9) Dienst entfernen: Tag ist frei, Historie behält den alten Stand
await eintragLoeschen(db, '2026-12-20');
const hh = await historie(db, '2026-12-20');
ok(!(await db.eintraege.get('2026-12-20')) && hh.length === 2 && hh[1].neu === null && hh[1].alt.code === '10004', 'Entfernen: Tag frei, Historie vollständig (anlegen, entfernen)');

// 10) Auswertung nach ganzen Kalenderwochen
const db2 = createDb('test2');
await turnusImportieren(db2, fs.readFileSync('daten/turnus_schichten.csv', 'utf8'), fs.readFileSync('daten/turnus_wochenruhe.csv', 'utf8'), '2026-12-13');
await planErzeugen(db2, '2026-12-14', 27);
const gedruckt = '40:06 36:49 33:13 37:57 38:11 39:05 34:38 35:30 36:13 35:13 29:27 33:13 40:29 33:03 34:58 32:33 36:30 34:12 34:37 39:29 36:08 40:23 41:52 35:30 34:19 39:28 38:26 41:58 40:26 35:13 34:15'.split(' ');
const montage31 = Array.from({ length: 31 }, (_, i) => addTage('2026-12-14', i * 7));
const a31 = await auswertungWochen(db2, montage31, '2026-12-14');
ok(a31.gesamt.ist === gedruckt.reduce((x, t) => x + minuten(t), 0), `31 Wochen Ist = ${hhmm(a31.gesamt.ist)} (Summe der gedruckten Wochen)`);
ok(a31.gesamt.soll === 31 * 38.5 * 60, `Soll 31 Wochen = ${hhmm(a31.gesamt.soll)} (31 x 38:30)`);
// einzelne Woche stimmt mit gedrucktem WoNAz überein (Woche 27 und 28; Sonntagsnacht in Wo 1, 10, 18 wird dem Starttag zugerechnet)
ok(hhmm(a31.wochen[0].ist) === '38:26' && hhmm(a31.wochen[1].ist) === '41:58', `Wochen 27/28: ${hhmm(a31.wochen[0].ist)} / ${hhmm(a31.wochen[1].ist)}`);
const nd = zeitraumFuer('2026-12-20'); const and = await auswertung(db2, nd.von, nd.bis, '2026-12-20');
ok(and.teilweise && and.wochen.length === 3 && and.wochenImZeitraum === 9, `Nov/Dez 2026: ${and.wochen.length} von ${and.wochenImZeitraum} Wochen im Plan`);
ok(and.anzeigeVon === '2026-11-02' && and.anzeigeBis === '2027-01-03', `Nov/Dez: Wochen ${and.anzeigeVon} bis ${and.anzeigeBis} (letzte Woche springt ins neue Jahr)`);
const jf = zeitraumFuer('2027-02-10'); const aj = await auswertung(db2, jf.von, jf.bis, '2027-02-01');
ok(aj.wochenImZeitraum === 8 && aj.anzeigeVon === '2027-01-04' && aj.anzeigeBis === '2027-02-28' && aj.gesamt.soll === 8 * 38.5 * 60, `Jän/Feb 2027: ${aj.wochenImZeitraum} Wochen ab ${aj.anzeigeVon}, Soll ${hhmm(aj.gesamt.soll)}`);
console.log(`Jän/Feb 2027: Ist ${hhmm(aj.gesamt.ist)}, Saldo ${hhmm(Math.abs(aj.gesamt.saldo))} ${aj.gesamt.saldo < 0 ? '(Minus)' : '(Plus)'}, davon Reserve: ${aj.reserve.anzahl} Dienste ${hhmm(aj.reserve.min)}`);

// 11) Ruhe: freier Tag statt Reserve-Dienst
const ru = await eintragSetzen(db2, '2026-12-27', { ruhe: true });
ok(ru.ruhe && ru.baz === '0:00' && (await wrAnteil(db2, '2026-12-27')) === null, 'Ruhe eingetragen (0:00 bAZ, keine WR-Prüfung)');

// 12) Nachtdienst über Mitternacht entfernt Reserve-Dienst am Folgetag (26.12.: 600000 03:30-11:42)
const vorher = await db2.eintraege.get('2026-12-26');
const k = await folgetagKonflikt(db2, '2026-12-25', { beginn: '18:14', ende: '06:51' });
ok(vorher.code === '600000' && k?.reserve === true, 'Vorschau erkennt Reserve-Dienst am Folgetag');
const n = await eintragSetzen(db2, '2026-12-25', { code: '10011', beginn: '18:14', ende: '06:51', baz: '12:07', kategorie: 'aenderung' });
ok(n.entfernt.length === 1 && !(await db2.eintraege.get('2026-12-26')), 'Reserve-Dienst am 26.12. entfernt');
const h2 = await historie(db2, '2026-12-26');
ok(h2.length === 1 && h2[0].neu === null && h2[0].grund.includes('10011'), `Historie hält fest: "${h2[0].grund}"`);
// späterer Reserve-Dienst (nach Dienstende) bleibt
await eintragSetzen(db2, '2026-12-28', { code: '10011', beginn: '18:14', ende: '06:51', baz: '12:07' }); // 29.12. ist frei
const k2 = await folgetagKonflikt(db2, '2026-12-19', { beginn: '20:00', ende: '02:00' });
ok(k2 === null, 'Kein Konflikt, wenn Folgetag leer ist');

// 13) Zurücksetzen
await planZuruecksetzen(db2);
ok((await db2.aenderungen.count()) === 0 && (await db2.eintraege.count()) === 182 && (await db2.eintraege.get('2026-12-26')).code === '600000', 'Plan zurückgesetzt: Historie leer, Turnus wieder da');
await allesLoeschen(db2);
ok((await db2.eintraege.count()) === 0 && (await db2.turnusTage.count()) === 0, 'Alles gelöscht');

// 14) DRZ-Ansicht: exakt Monate, Soll 5:30 je Tag, Teilwoche am Rand
await turnusImportieren(db2, fs.readFileSync('daten/turnus_schichten.csv', 'utf8'), fs.readFileSync('daten/turnus_wochenruhe.csv', 'utf8'), '2026-12-13');
await planErzeugen(db2, '2026-12-14', 27);
const dnd = await auswertungDrz(db2, '2026-11-01', '2026-12-31', '2026-12-20');
ok(dnd.planTage === 18 && dnd.gesamt.soll === 18 * 330 && dnd.anzeigeBis === '2026-12-31', `DRZ Nov/Dez: ${dnd.planTage} Plantage, Soll ${hhmm(dnd.gesamt.soll)}, endet ${dnd.anzeigeBis}`);
const letzteWoche = dnd.wochen.at(-1);
ok(letzteWoche.von === '2026-12-28' && letzteWoche.bis === '2026-12-31' && letzteWoche.teilwoche && letzteWoche.tage === 4, `Letzte Woche im DRZ: ${letzteWoche.von} bis ${letzteWoche.bis} (Teilwoche, ${letzteWoche.tage} Tage, Soll ${hhmm(letzteWoche.soll)})`);
const djf = await auswertungDrz(db2, '2027-01-01', '2027-02-28', '2027-02-01');
ok(djf.tageImZeitraum === 59 && djf.gesamt.soll === 59 * 330, `DRZ Jän/Feb: 59 Tage, Soll ${hhmm(djf.gesamt.soll)} (324:30)`);
const kwjf = await auswertung(db2, '2027-01-01', '2027-02-28', '2027-02-01');
console.log(`Jän/Feb 2027  DRZ: Ist ${hhmm(djf.gesamt.ist)} | Kalenderwochen: Ist ${hhmm(kwjf.gesamt.ist)}`);

// 15) WR versetzen + Historie einzeln löschen
const wrTag = await wochenruhenFuerTag(db2, '2026-12-20');
ok(wrTag.length === 1 && wrTag[0].start === '2026-12-19 17:29' && wrTag[0].ende === '2026-12-21 05:29', `WR am 20.12.: ${wrTag[0].start} bis ${wrTag[0].ende}`);
await eintragSetzen(db2, '2026-12-21', { code: '10005', beginn: '04:00', ende: '12:00', baz: '7:15' });
const vorWr = await wrAnteil(db2, '2026-12-21');
await wrVersetzen(db2, wrTag[0].id, { start: '2026-12-19 15:29', ende: '2026-12-21 03:29' });
const nachWr = await wrAnteil(db2, '2026-12-21');
ok(vorWr.inWr === 89 && nachWr.inWr === 0, `WR versetzt: Dienstanteil in der WR vorher ${hhmm(vorWr.inWr)}h, nachher ${hhmm(nachWr.inWr)}h`);
const hw = (await historie(db2)).filter((h) => h.art === 'wr');
ok(hw.length === 1 && hw[0].alt.ende === '2026-12-21 05:29' && hw[0].neu.ende === '2026-12-21 03:29', 'WR-Verschiebung steht in der Historie (alt und neu)');
ok((await historie(db2, '2026-12-20')).some((h) => h.art === 'wr'), 'WR-Änderung erscheint auch an einem Tag mitten in der WR (20.12.)');
let fehler = null; try { await wrVersetzen(db2, wrTag[0].id, { start: '2026-12-21 10:00', ende: '2026-12-21 09:00' }); } catch (e) { fehler = e.message; }
ok(fehler?.includes('nach dem Start'), 'Ende vor Start wird abgelehnt');
const vorLoesch = (await historie(db2)).length;
await historieEintragLoeschen(db2, hw[0].id);
ok((await historie(db2)).length === vorLoesch - 1 && (await wochenruhenFuerTag(db2, '2026-12-20'))[0].start === '2026-12-19 15:29', 'Einzelner Historieneintrag gelöscht, die WR-Änderung selbst bleibt');

// ---- verschlüsselte Turnus-Datei
{
  const { turnusDateiOeffnen } = await import('./src/krypto.js');
  const { readFileSync } = await import('node:fs');
  const datei = JSON.parse(readFileSync('./public/turnus.enc.json', 'utf8'));
  const ma = readFileSync('./daten/mitarbeiter.csv', 'utf8').trim().split('\n').map((z) => z.split(';'));
  let alleOk = true;
  for (const [n, d] of ma) { const t = await turnusDateiOeffnen(datei, d); if (!t || t.woche !== +n) alleOk = false; }
  console.log(alleOk ? 'OK    ' : 'FEHLER', 'alle 31 Dienstnummern öffnen die richtige Turnus-Woche');
  const t27 = await turnusDateiOeffnen(datei, ma.find((m) => m[0] === '27')[1]);
  console.log(t27.schichtenCsv === readFileSync('./daten/turnus_schichten.csv', 'utf8') && t27.planStart === '2026-12-14' ? 'OK    ' : 'FEHLER', 'Inhalt unverändert, Planstart 14.12.2026');
  console.log((await turnusDateiOeffnen(datei, '000000')) === null ? 'OK    ' : 'FEHLER', 'unbekannte Nummer wird abgelehnt');
  const roh = readFileSync('./public/turnus.enc.json', 'utf8');
  console.log(!ma.some((m) => roh.includes(m[1])) && !roh.includes('10011') ? 'OK    ' : 'FEHLER', 'weder Nummern noch Schichtcodes im Klartext');
}
