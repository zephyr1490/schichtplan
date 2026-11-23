// Auswertung: bAZ-Summen und Saldo im Durchrechnungszeitraum (je 2 Monate).
import { addTage, tageNr, wochentag, minuten, hhmm } from './zeit.js';

export const SOLL_MIN_PRO_TAG = (38 * 60 + 30) / 7; // 38:30 pro Woche = 5:30 pro Tag

// Sonntagsnächte über Mitternacht: der Plan rechnet bei Wochenwechsel getrennt. Für die Summe über
// einen Zeitraum zählt der ganze Dienst am Starttag. Reste laut Turnus (Wo 2, 11, 19), in Minuten.
const SONNTAG_REST = { '10009': 81, '10011': 381, '10008': 21 };
export const bazMinuten = (e) => {
  if (!e.baz) return 0;
  const rest = e.endeFolgetag && wochentag(e.datum) === 6 ? (SONNTAG_REST[e.code] ?? minuten(e.ende)) : 0;
  return minuten(e.baz) + rest;
};

export const hhmmMitZeichen = (min) => (min > 0 ? '+' : min < 0 ? '−' : '') + hhmm(Math.abs(min));

// Durchrechnungszeitraum, der ein Datum enthält: Jänner/Februar, März/April, ...
export function zeitraumFuer(datum) {
  const j = +datum.slice(0, 4), m = +datum.slice(5, 7);
  const m1 = m % 2 === 1 ? m : m - 1;
  const p = (n) => String(n).padStart(2, '0');
  const von = `${j}-${p(m1)}-01`;
  const bis = new Date(Date.UTC(j, m1 + 1, 0)).toISOString().slice(0, 10); // letzter Tag des 2. Monats
  return { von, bis };
}
export const naechsterZeitraum = (z, n) => zeitraumFuer(addTage(n > 0 ? addTage(z.bis, 1) : addTage(z.von, -1), 0));

export async function auswertung(db, von, bis, heute) {
  const start = (await db.einstellungen.get('turnusStart'))?.value;
  const planVon = start?.startDatum ?? von;
  const planBis = start ? addTage(start.startDatum, (start.anzahlWochen ?? 52) * 7 - 1) : bis;
  const eintraege = await db.eintraege.where('datum').between(von, bis, true, true).toArray();
  const istProTag = new Map(eintraege.map((e) => [e.datum, bazMinuten(e)]));

  const zaehle = (a, b) => {          // Ist und Soll von a bis b, nur Tage im Plan
    let ist = 0, soll = 0, tage = 0;
    for (let d = a; d <= b; d = addTage(d, 1)) {
      if (d < planVon || d > planBis) continue;
      tage++; soll += SOLL_MIN_PRO_TAG; ist += istProTag.get(d) ?? 0;
    }
    return { ist, soll, saldo: ist - soll, tage };
  };

  // Wochen (Mo–So), am Rand auf den Zeitraum zugeschnitten
  const wochen = [];
  let montag = addTage(von, -wochentag(von));
  let kumuliert = 0;
  for (; montag <= bis; montag = addTage(montag, 7)) {
    const a = montag < von ? von : montag, sonntag = addTage(montag, 6), b = sonntag > bis ? bis : sonntag;
    const z = zaehle(a, b);
    kumuliert += z.saldo;
    wochen.push({ von: a, bis: b, ...z, kumuliert });
  }
  const gesamt = zaehle(von, bis);
  const gestern = addTage(heute, -1);
  const bisHeute = gestern < von ? null : zaehle(von, gestern > bis ? bis : gestern);
  const tageImZeitraum = tageNr(bis) - tageNr(von) + 1;
  return { von, bis, gesamt, bisHeute, wochen, teilweise: gesamt.tage < tageImZeitraum, tageImZeitraum };
}
