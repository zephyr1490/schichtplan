// Aufbereitung der Daten für die Anzeige (keine Oberfläche hier, damit testbar).
import { TAGE, addTage, tageNr, wochentag, absMinAusTag, hhmm, minuten } from './zeit.js';

const absStr = (s) => { const [d, z] = s.split(' '); return tageNr(d) * 1440 + minuten(z); };

export function tageImMonat(jahr, monat) {
  const n = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  const m = String(monat).padStart(2, '0');
  return Array.from({ length: n }, (_, i) => `${jahr}-${m}-${String(i + 1).padStart(2, '0')}`);
}

// WR-Abschnitt für einen Tag als Text, z.B. "WR ganztägig", "WR ab 16:12", "WR bis 04:12"
function wrText(von, bis) {
  if (von === 0 && bis === 1440) return 'WR ganztägig';
  if (von === 0) return `WR bis ${hhmm(bis).padStart(5, '0')}`;
  if (bis === 1440) return `WR ab ${hhmm(von).padStart(5, '0')}`;
  return `WR ${hhmm(von).padStart(5, '0')}–${hhmm(bis).padStart(5, '0')}`;
}

export async function monatsDaten(db, jahr, monat) {
  const tage = tageImMonat(jahr, monat);
  const eintraege = await db.eintraege.where('datum').between(addTage(tage[0], -1), tage.at(-1), true, true).toArray();
  const byDatum = new Map(eintraege.map((e) => [e.datum, e]));
  const wr = (await db.wochenruhen.toArray()).map((w) => ({ s: absStr(w.start), e: absStr(w.ende) }));
  const start = (await db.einstellungen.get('turnusStart'))?.value;

  return tage.map((datum) => {
    const roh = byDatum.get(datum) ?? null;
    const eintrag = roh?.ruhe ? null : roh; // Ruhe sieht aus wie ein freier Tag
    const vortag = byDatum.get(addTage(datum, -1));
    const fortsetzung = vortag?.endeFolgetag ? { code: vortag.code, ende: vortag.ende } : null;
    const ds = tageNr(datum) * 1440;
    const wrTeile = [];
    for (const w of wr) {
      const von = Math.max(w.s, ds) - ds; const bis = Math.min(w.e, ds + 1440) - ds;
      if (bis > von) wrTeile.push(wrText(von, bis));
    }
    let turnusWoche = null;
    const imPlan = !!start && datum >= start.startDatum && datum < addTage(start.startDatum, (start.anzahlWochen ?? 52) * 7);
    if (imPlan) {
      const wochen = Math.floor((tageNr(datum) - tageNr(start.startDatum)) / 7);
      turnusWoche = ((start.startWoche - 1 + wochen) % 31) + 1;
    }
    return {
      datum, wt: wochentag(datum), wtName: TAGE[wochentag(datum)], tag: +datum.slice(8),
      eintrag, fortsetzung, wr: wrTeile, turnusWoche, imPlan,
      reserve: !!eintrag && eintrag.code.startsWith('6000'),
    };
  });
}
