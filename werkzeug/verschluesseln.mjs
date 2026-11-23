// Aufruf: node werkzeug/verschluesseln.mjs mitarbeiter.csv turnus_schichten.csv turnus_wochenruhe.csv 2026-12-13 2026-12-14 public/turnus.enc.json
// mitarbeiter.csv: Zeilen "nummer;dienstnummer" (NICHT ins Repo legen)
import { readFileSync, writeFileSync } from 'node:fs';
import { turnusDateiErzeugen } from '../src/krypto.js';
const [ma, sch, wr, gueltigAb, planStart, aus] = process.argv.slice(2);
const mitarbeiter = readFileSync(ma, 'utf8').trim().split(/\r?\n/).map((z) => { const [n, d] = z.split(';'); return { nummer: +n, dienstnummer: d.trim() }; });
const datei = await turnusDateiErzeugen(mitarbeiter, { gueltigAb, planStart, schichtenCsv: readFileSync(sch, 'utf8'), wrCsv: readFileSync(wr, 'utf8') });
writeFileSync(aus, JSON.stringify(datei));
console.log('geschrieben:', aus, mitarbeiter.length, 'Zugänge');
