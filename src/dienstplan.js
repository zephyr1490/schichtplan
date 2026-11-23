import { TAGE, minuten, hhmm, addTage, tageNr, wochentag, absMin, parseCsv } from './zeit.js';

const NR_TURNUS_WOCHEN = 31;

// ---------------------------------------------------------------------------
// 1) Turnus (Vorlage) einlesen. Daraus entstehen auch Schichttypen + Tagesregeln.
// ---------------------------------------------------------------------------
export async function turnusImportieren(db, schichtenCsv, wochenruheCsv, gueltigAb) {
  const tage = parseCsv(schichtenCsv).map(([woche, tag, code, beginn, ende, , baz]) => ({
    woche: +woche, tag: TAGE.indexOf(tag), code, beginn, ende, baz,
  }));
  const wr = parseCsv(wochenruheCsv).map(([woche, sTag, sZeit, eTag, eZeit]) => ({
    woche: +woche, startTag: TAGE.indexOf(sTag), startZeit: sZeit, endTag: TAGE.indexOf(eTag), endZeit: eZeit,
  }));

  // Schichttypen + Version mit Regel "Schicht + Wochentag -> Zeiten"
  const regeln = {};
  for (const t of tage) {
    regeln[t.code] ??= {};
    regeln[t.code][t.tag] ??= { beginn: t.beginn, ende: t.ende, baz: t.baz };
  }
  await db.transaction('rw', db.tables, async () => {
    await Promise.all([db.turnusTage.clear(), db.turnusWr.clear(), db.schichtTypen.clear(), db.schichtVersionen.clear()]);
    await db.turnusTage.bulkAdd(tage);
    await db.turnusWr.bulkAdd(wr);
    for (const code of Object.keys(regeln)) {
      await db.schichtTypen.put({ code });
      await db.schichtVersionen.add({ code, gueltigAb, gueltigBis: null, regeln: regeln[code] });
    }
  });
  return { tage: tage.length, wochenruhen: wr.length, schichtTypen: Object.keys(regeln).length };
}

// ---------------------------------------------------------------------------
// 2) Plan aus dem Turnus erzeugen: ab Datum (Montag) in einer bestimmten Turnus-Woche
// ---------------------------------------------------------------------------
export async function planErzeugen(db, startDatum, startWoche, anzahlWochen = 52) {
  if (wochentag(startDatum) !== 0) throw new Error(`${startDatum} ist kein Montag`);
  const tage = await db.turnusTage.toArray();
  const wr = await db.turnusWr.toArray();
  const tagMap = new Map(tage.map((t) => [`${t.woche}-${t.tag}`, t]));

  const eintraege = [];
  const wochenruhen = [];
  // w = -1: Vorwoche, nur wegen einer Wochenruhe, die in den Plan hineinreicht
  for (let w = -1; w < anzahlWochen; w++) {
    const turnusWoche = ((startWoche - 1 + w + NR_TURNUS_WOCHEN) % NR_TURNUS_WOCHEN) + 1;
    const montag = addTage(startDatum, w * 7);
    for (let tag = 0; tag < 7 && w >= 0; tag++) {
      const t = tagMap.get(`${turnusWoche}-${tag}`);
      if (!t) continue;
      eintraege.push({
        datum: addTage(montag, tag), code: t.code, beginn: t.beginn, ende: t.ende,
        endeFolgetag: minuten(t.ende) < minuten(t.beginn), baz: t.baz,
        kategorie: 'geplant', nrv: false, quelle: 'turnus', turnusWoche,
      });
    }
    for (const r of wr.filter((x) => x.woche === turnusWoche)) {
      const startDat = addTage(montag, r.startTag);
      const tageBis = (r.endTag - r.startTag + 7) % 7;
      if (w === -1 && addTage(startDat, tageBis) < startDatum) continue;
      wochenruhen.push({
        start: `${startDat} ${r.startZeit}`, ende: `${addTage(startDat, tageBis)} ${r.endZeit}`,
      });
    }
  }
  await db.transaction('rw', db.eintraege, db.wochenruhen, async () => {
    await db.eintraege.clear(); await db.wochenruhen.clear();
    await db.eintraege.bulkAdd(eintraege); await db.wochenruhen.bulkAdd(wochenruhen);
  });
  await db.einstellungen.put({ key: 'turnusStart', value: { startDatum, startWoche, anzahlWochen } });
  return { eintraege: eintraege.length, wochenruhen: wochenruhen.length };
}

// ---------------------------------------------------------------------------
// 3) Vorschlag für Zeiten, wenn ich selbst einen Dienst eintrage (nur Komfort, keine Prüfung)
// ---------------------------------------------------------------------------
export async function zeitenVorschlag(db, code, datum) {
  const versionen = await db.schichtVersionen.where('code').equals(code).toArray();
  const passend = versionen
    .filter((v) => v.gueltigAb <= datum && (!v.gueltigBis || datum <= v.gueltigBis))
    .sort((a, b) => b.gueltigAb.localeCompare(a.gueltigAb))[0];
  return passend?.regeln?.[wochentag(datum)] ?? null; // null = nichts bekannt, selbst eintragen
}

// ---------------------------------------------------------------------------
// 4) Eintrag setzen/ändern. Jede Änderung landet zusätzlich in der Historie (nur anhängen).
// ---------------------------------------------------------------------------
export async function eintragSetzen(db, datum, werte, jetzt = new Date()) {
  const alt = (await db.eintraege.get(datum)) ?? null;
  let { code, beginn, ende, baz } = werte;
  if (!beginn || !ende) {
    const v = await zeitenVorschlag(db, code, datum);
    if (v) { beginn ??= v.beginn; ende ??= v.ende; baz ??= v.baz; }
  }
  if (!beginn || !ende) throw new Error(`Für ${code} am ${datum} sind keine Zeiten bekannt – bitte Beginn und Ende angeben.`);
  const neu = {
    datum, code, beginn, ende, endeFolgetag: minuten(ende) < minuten(beginn), baz: baz ?? null,
    kategorie: werte.kategorie ?? 'aenderung', nrv: werte.nrv ?? false, quelle: 'manuell',
  };
  await db.transaction('rw', db.eintraege, db.aenderungen, async () => {
    await db.eintraege.put(neu);
    await db.aenderungen.add({ datum, zeitstempel: jetzt.toISOString(), alt, neu, nrv: neu.nrv });
  });
  return neu;
}

export async function nrvSetzen(db, datum, nrv, jetzt = new Date()) {
  const alt = await db.eintraege.get(datum);
  const neu = { ...alt, nrv };
  await db.transaction('rw', db.eintraege, db.aenderungen, async () => {
    await db.eintraege.put(neu);
    await db.aenderungen.add({ datum, zeitstempel: jetzt.toISOString(), alt, neu, nrv });
  });
}

// ---------------------------------------------------------------------------
// 5) Wie viel von einem Dienst liegt in der Wochenruhe? (nur Hinweis, keine Abrechnung)
// ---------------------------------------------------------------------------
export async function wrAnteil(db, datum) {
  const e = await db.eintraege.get(datum);
  if (!e) return null;
  const s = absMin(datum, e.beginn);
  const en = e.endeFolgetag ? absMin(addTage(datum, 1), e.ende) : absMin(datum, e.ende);
  let innen = 0;
  for (const w of await db.wochenruhen.toArray()) {
    const [sd, sz] = w.start.split(' '); const [ed, ez] = w.ende.split(' ');
    const ws = absMin(sd, sz), we = absMin(ed, ez);
    innen += Math.max(0, Math.min(en, we) - Math.max(s, ws));
  }
  return { gesamt: en - s, inWr: innen, ausserhalb: en - s - innen, text: innen ? `${hhmm(innen)}h in der WR` : 'nicht in der WR' };
}

// Summe bAZ über einen Zeitraum (für spätere Analyse; hier nur zum Gegenprüfen)
export async function bazSumme(db, von, bis) {
  const alle = await db.eintraege.where('datum').between(von, bis, true, true).toArray();
  return alle.reduce((s, e) => s + (e.baz ? minuten(e.baz) : 0), 0);
}
