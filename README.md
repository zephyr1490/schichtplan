# Dienstplan

Persönliche Dienstplan-App. Alle Daten bleiben lokal im Browser (IndexedDB), kein Server, keine Konten.

Die Turnus-Dateien (`turnus_schichten.csv`, `turnus_wochenruhe.csv`) sind nicht Teil dieses Repos und werden bei der Einrichtung in der App ausgewählt.

- `npm install`
- `npm run dev` – lokal starten
- `npm run build` – Produktionsversion nach `dist/`
- `npm test` – Datenschicht testen (benötigt den Ordner `daten/` mit den beiden CSV-Dateien)
