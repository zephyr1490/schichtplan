// Lokale Datenschicht (IndexedDB via Dexie). Kein Backend, keine Konten.
import Dexie from 'dexie';

export function createDb(name = 'dienstplan', options = {}) {
  const db = new Dexie(name, options);
  db.version(1).stores({
    schichtTypen: 'code',                 // 10004, 600001, ...
    schichtVersionen: '++id, code, gueltigAb', // Zeiten je Version, pro Wochentag
    turnusTage: '[woche+tag], woche',     // Vorlage: 31 Wochen
    turnusWr: '++id, woche',              // Wochenruhe-Blöcke der Vorlage
    einstellungen: 'key',                 // z.B. Turnus-Start
    eintraege: 'datum',                   // ein Eintrag pro Kalendertag
    wochenruhen: '++id, start',           // WR mit echtem Datum/Uhrzeit
    aenderungen: '++id, datum, zeitstempel', // nur anhängen, nie ändern
  });
  return db;
}
