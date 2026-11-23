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
  let neu;
  if (werte.ruhe) {
    // "weiße Ruhe": freier Tag, ausdrücklich keine Wochenruhe (WR)
    neu = { datum, code: 'Ruhe', beginn: null, ende: null, endeFolgetag: false, baz: '0:00', ruhe: true,
      kategorie: werte.kategorie ?? 'aenderung', nrv: werte.nrv ?? false, quelle: 'manuell' };
  } else {
    let { code, beginn, ende, baz } = werte;
    if (!beginn || !ende) {
      const v = await zeitenVorschlag(db, code, datum);
      if (v) { beginn ??= v.beginn; ende ??= v.ende; baz ??= v.baz; }
    }
    if (!beginn || !ende) throw new Error(`Für ${code} am ${datum} sind keine Zeiten bekannt – bitte Beginn und Ende angeben.`);
    neu = {
      datum, code, beginn, ende, endeFolgetag: minuten(ende) < minuten(beginn), baz: baz ?? null,
      kategorie: werte.kategorie ?? 'aenderung', nrv: werte.nrv ?? false, quelle: 'manuell',
    };
  }
  const entfernt = [];
  await db.transaction('rw', db.eintraege, db.aenderungen, async () => {
    await db.eintraege.put(neu);
    await db.aenderungen.add({ datum, zeitstempel: jetzt.toISOString(), alt, neu, nrv: neu.nrv });
    // Nachtdienst über Mitternacht: ein Reserve-Dienst am Folgetag, der hineinfällt, entfällt
    const k = await folgetagKonflikt(db, datum, neu);
    if (k?.reserve) {
      await db.eintraege.delete(k.eintrag.datum);
      await db.aenderungen.add({ datum: k.eintrag.datum, zeitstempel: jetzt.toISOString(), alt: k.eintrag, neu: null,
        nrv: k.eintrag.nrv ?? false, grund: `entfällt wegen ${neu.code} vom Vortag` });
      entfernt.push(k.eintrag);
    }
  });
  return { ...neu, entfernt };
}

// Liegt am Folgetag ein Eintrag, der in diesen (über Mitternacht gehenden) Dienst hineinfällt?
export async function folgetagKonflikt(db, datum, e) {
  if (!e || e.ruhe || !e.beginn || !e.ende || !(minuten(e.ende) < minuten(e.beginn))) return null;
  const n = await db.eintraege.get(addTage(datum, 1));
  if (!n || n.ruhe || !n.beginn || minuten(n.beginn) >= minuten(e.ende)) return null;
  return { eintrag: n, reserve: n.code.startsWith('6000') };
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
export function wrAnteilBerechnen(wochenruhen, datum, beginn, ende) {
  const endeFolgetag = minuten(ende) < minuten(beginn);
  const s = absMin(datum, beginn);
  const en = endeFolgetag ? absMin(addTage(datum, 1), ende) : absMin(datum, ende);
  let innen = 0;
  for (const w of wochenruhen) {
    const [sd, sz] = w.start.split(' '); const [ed, ez] = w.ende.split(' ');
    innen += Math.max(0, Math.min(en, absMin(ed, ez)) - Math.max(s, absMin(sd, sz)));
  }
  return { gesamt: en - s, inWr: innen, ausserhalb: en - s - innen, text: innen ? `${hhmm(innen)}h in der WR` : 'nicht in der WR' };
}

export async function wrAnteil(db, datum) {
  const e = await db.eintraege.get(datum);
  if (!e || e.ruhe) return null;
  return wrAnteilBerechnen(await db.wochenruhen.toArray(), datum, e.beginn, e.ende);
}

export async function eintragLoeschen(db, datum, jetzt = new Date()) {
  const alt = await db.eintraege.get(datum);
  if (!alt) return;
  await db.transaction('rw', db.eintraege, db.aenderungen, async () => {
    await db.eintraege.delete(datum);
    await db.aenderungen.add({ datum, zeitstempel: jetzt.toISOString(), alt, neu: null, nrv: alt.nrv ?? false });
  });
}

export async function historie(db, datum = null) {
  const alle = await db.aenderungen.toArray();
  const gefiltert = datum ? alle.filter((h) => {
    if (h.datum === datum) return true;
    if (h.art !== 'wr') return false;
    const tage = [h.alt, h.neu].flatMap((w) => [w.start.slice(0, 10), w.ende.slice(0, 10)]);
    return datum >= tage.reduce((a, b) => (a < b ? a : b)) && datum <= tage.reduce((a, b) => (a > b ? a : b));
  }) : alle;
  return gefiltert.sort((a, b) => a.id - b.id);
}

export async function historieEintragLoeschen(db, id) {
  await db.aenderungen.delete(id);
}

// Wochenruhen, die einen Kalendertag berühren (als Eintrag mit id)
export async function wochenruhenFuerTag(db, datum) {
  return (await db.wochenruhen.toArray()).filter((w) => w.start.slice(0, 10) <= datum && w.ende.slice(0, 10) >= datum)
    .sort((a, b) => a.start.localeCompare(b.start));
}

// WR zeitlich versetzen (Ausnahme, z.B. wenn ich einem Dienst in der WR zustimme). Start/Ende als 'YYYY-MM-DD HH:MM'.
export async function wrVersetzen(db, id, { start, ende }, jetzt = new Date()) {
  const fmt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
  if (!fmt.test(start) || !fmt.test(ende)) throw new Error('Bitte Datum und Uhrzeit für Start und Ende angeben.');
  const abs = (t) => absMin(t.slice(0, 10), t.slice(11));
  if (abs(ende) <= abs(start)) throw new Error('Das Ende der WR muss nach dem Start liegen.');
  const alt = await db.wochenruhen.get(id);
  if (!alt) throw new Error('Diese WR gibt es nicht mehr.');
  if (alt.start === start && alt.ende === ende) return alt;
  const neu = { ...alt, start, ende };
  await db.transaction('rw', db.wochenruhen, db.aenderungen, async () => {
    await db.wochenruhen.put(neu);
    await db.aenderungen.add({ art: 'wr', wrId: id, datum: alt.start.slice(0, 10), zeitstempel: jetzt.toISOString(),
      alt: { start: alt.start, ende: alt.ende }, neu: { start, ende }, nrv: false });
  });
  return neu;
}

// Summe bAZ über einen Zeitraum (für spätere Analyse; hier nur zum Gegenprüfen)
export async function bazSumme(db, von, bis) {
  const alle = await db.eintraege.where('datum').between(von, bis, true, true).toArray();
  return alle.reduce((s, e) => s + (e.baz ? minuten(e.baz) : 0), 0);
}

// ---------------------------------------------------------------------------
// Zurücksetzen (zum Testen)
// ---------------------------------------------------------------------------
export async function planZuruecksetzen(db) {
  const start = (await db.einstellungen.get('turnusStart'))?.value;
  if (!start) throw new Error('Kein Plan vorhanden.');
  await db.aenderungen.clear();
  return planErzeugen(db, start.startDatum, start.startWoche, start.anzahlWochen ?? 52);
}
export async function allesLoeschen(db) {
  await db.transaction('rw', db.tables, async () => { for (const t of db.tables) await t.clear(); });
}
