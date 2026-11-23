// Sicherung: kompletter Stand als eine Datei (und wieder zurückspielen).
const TABELLEN = ['schichtTypen', 'schichtVersionen', 'turnusTage', 'turnusWr', 'einstellungen', 'eintraege', 'wochenruhen', 'aenderungen'];

export async function sicherungErstellen(db) {
  const daten = {};
  for (const t of TABELLEN) daten[t] = await db.table(t).toArray();
  return { format: 'dienstplan-sicherung', version: 1, erstellt: new Date().toISOString(), daten };
}

export async function sicherungEinspielen(db, obj) {
  if (obj?.format !== 'dienstplan-sicherung') throw new Error('Das ist keine Sicherungsdatei dieser App.');
  await db.transaction('rw', db.tables, async () => {
    for (const t of TABELLEN) {
      await db.table(t).clear();
      if (obj.daten[t]?.length) await db.table(t).bulkAdd(obj.daten[t]);
    }
  });
}
