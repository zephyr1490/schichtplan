// Auswertung: bAZ-Summen und Saldo im Durchrechnungszeitraum (je 2 Monate), nach ganzen Kalenderwochen.
import { addTage, tageNr, wochentag, minuten, hhmm } from './zeit.js';

export const SOLL_MIN_PRO_TAG = (38 * 60 + 30) / 7; // 38:30 pro Woche = 5:30 pro Tag
export const SOLL_MIN_PRO_WOCHE = 38 * 60 + 30;

// Sonntagsnächte über Mitternacht: der Plan rechnet bei Wochenwechsel getrennt. Für die Summe zählt
// der ganze Dienst am Starttag. Reste laut Turnus (Wo 2, 11, 19), in Minuten.
const SONNTAG_REST = { '10009': 81, '10011': 381, '10008': 21 };
export const bazMinuten = (e) => {
  if (!e.baz) return 0;
  const rest = e.endeFolgetag && wochentag(e.datum) === 6 ? (SONNTAG_REST[e.code] ?? minuten(e.ende)) : 0;
  return minuten(e.baz) + rest;
};

export const hhmmMitZeichen = (min) => (min > 0 ? '+' : min < 0 ? '−' : '') + hhmm(Math.abs(min));

// Durchrechnungszeitraum (Monate), der ein Datum enthält: Jänner/Februar, März/April, ...
export function zeitraumFuer(datum) {
  const j = +datum.slice(0, 4), m = +datum.slice(5, 7);
  const m1 = m % 2 === 1 ? m : m - 1;
  const p = (n) => String(n).padStart(2, '0');
  return { von: `${j}-${p(m1)}-01`, bis: new Date(Date.UTC(j, m1 + 1, 0)).toISOString().slice(0, 10) };
}

// Montage der Wochen, die zum Zeitraum gehören: Wochen, deren Donnerstag im Zeitraum liegt.
export function wochenMontage(von, bis) {
  const montage = [];
  for (let m = addTage(von, -wochentag(von) - 7); m <= bis; m = addTage(m, 7)) {
    const donnerstag = addTage(m, 3);
    if (donnerstag >= von && donnerstag <= bis) montage.push(m);
  }
  return montage;
}

export async function auswertungWochen(db, montage, heute) {
  const start = (await db.einstellungen.get('turnusStart'))?.value;
  const planVon = start?.startDatum ?? montage[0];
  const planBis = start ? addTage(start.startDatum, (start.anzahlWochen ?? 52) * 7 - 1) : addTage(montage.at(-1), 6);
  const imPlan = montage.filter((m) => m >= planVon && m <= planBis);
  const erster = imPlan[0], letzter = imPlan.at(-1);
  const eintraege = imPlan.length ? await db.eintraege.where('datum').between(erster, addTage(letzter, 6), true, true).toArray() : [];
  const istProTag = new Map(eintraege.map((e) => [e.datum, bazMinuten(e)]));

  let kumuliert = 0;
  const wochen = imPlan.map((m) => {
    let ist = 0;
    for (let i = 0; i < 7; i++) ist += istProTag.get(addTage(m, i)) ?? 0;
    const saldo = ist - SOLL_MIN_PRO_WOCHE; kumuliert += saldo;
    return { von: m, bis: addTage(m, 6), ist, soll: SOLL_MIN_PRO_WOCHE, saldo, kumuliert };
  });
  const gesamt = wochen.reduce((s, w) => ({ ist: s.ist + w.ist, soll: s.soll + w.soll }), { ist: 0, soll: 0 });
  gesamt.saldo = gesamt.ist - gesamt.soll;

  // "bis gestern": nur abgeschlossene Tage, Soll anteilig je Tag
  const gestern = addTage(heute, -1);
  let bisHeute = null;
  for (const m of imPlan) for (let i = 0; i < 7; i++) {
    const d = addTage(m, i); if (d > gestern) continue;
    bisHeute ??= { ist: 0, soll: 0 };
    bisHeute.ist += istProTag.get(d) ?? 0; bisHeute.soll += SOLL_MIN_PRO_TAG;
  }
  if (bisHeute) bisHeute.saldo = bisHeute.ist - bisHeute.soll;

  // Reserve-Dienste (Platzhalter) zählen mit ihrer hinterlegten bAZ, werden aber ausgewiesen
  const reserve = eintraege.filter((e) => e.code.startsWith('6000'));
  return {
    wochen, gesamt, bisHeute, teilweise: imPlan.length < montage.length, wochenImZeitraum: montage.length,
    reserve: { anzahl: reserve.length, min: reserve.reduce((s, e) => s + bazMinuten(e), 0) },
    anzeigeVon: montage[0], anzeigeBis: addTage(montage.at(-1), 6),
  };
}

export const auswertung = (db, von, bis, heute) => auswertungWochen(db, wochenMontage(von, bis), heute);

// DRZ: exakt vom ersten bis zum letzten Tag der zwei Monate. Soll je Tag 5:30. Wochen am Rand sind Teilwochen.
export async function auswertungDrz(db, von, bis, heute) {
  const start = (await db.einstellungen.get('turnusStart'))?.value;
  const planVon = start?.startDatum ?? von;
  const planBis = start ? addTage(start.startDatum, (start.anzahlWochen ?? 52) * 7 - 1) : bis;
  const eintraege = await db.eintraege.where('datum').between(von, bis, true, true).toArray();
  const istProTag = new Map(eintraege.map((e) => [e.datum, bazMinuten(e)]));
  const gestern = addTage(heute, -1);
  const tageGesamt = tageNr(bis) - tageNr(von) + 1;

  const wochen = []; let kumuliert = 0, planTage = 0, bisHeute = null;
  for (let m = addTage(von, -wochentag(von)); m <= bis; m = addTage(m, 7)) {
    const a = m < von ? von : m, sonntag = addTage(m, 6), b = sonntag > bis ? bis : sonntag;
    let ist = 0, tage = 0;
    for (let d = a; d <= b; d = addTage(d, 1)) {
      if (d < planVon || d > planBis) continue;
      tage++; ist += istProTag.get(d) ?? 0;
      if (d <= gestern) { bisHeute ??= { ist: 0, soll: 0 }; bisHeute.ist += istProTag.get(d) ?? 0; bisHeute.soll += SOLL_MIN_PRO_TAG; }
    }
    if (!tage) continue;
    planTage += tage;
    const soll = tage * SOLL_MIN_PRO_TAG, saldo = ist - soll; kumuliert += saldo;
    wochen.push({ von: a, bis: b, ist, soll, saldo, kumuliert, tage, teilwoche: tage < 7 });
  }
  if (bisHeute) bisHeute.saldo = bisHeute.ist - bisHeute.soll;
  const gesamt = wochen.reduce((x, w) => ({ ist: x.ist + w.ist, soll: x.soll + w.soll }), { ist: 0, soll: 0 });
  gesamt.saldo = gesamt.ist - gesamt.soll;
  const reserve = eintraege.filter((e) => e.code.startsWith('6000') && e.datum >= planVon && e.datum <= planBis);
  return {
    wochen, gesamt, bisHeute, teilweise: planTage < tageGesamt, tageImZeitraum: tageGesamt, planTage,
    reserve: { anzahl: reserve.length, min: reserve.reduce((x, e) => x + bazMinuten(e), 0) }, anzeigeVon: von, anzeigeBis: bis,
  };
}
