import { createDb } from './db.js';
import { turnusImportieren, planErzeugen } from './dienstplan.js';
import { monatsDaten } from './ansicht.js';
import { sicherungErstellen, sicherungEinspielen } from './sicherung.js';
import { TAGE, addTage, wochentag } from './zeit.js';

const db = createDb('dienstplan');
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const heuteStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const zweiStellig = (n) => String(n).padStart(2, '0');

const state = { seite: 'kalender', ansicht: window.innerWidth > 720 ? 'raster' : 'liste', jahr: null, monat: null };

// ---------------------------------------------------------------- Start
async function start() {
  const anzahl = await db.eintraege.count();
  if (anzahl > 0) {
    // Startmonat: heute, wenn der Plan schon läuft, sonst Beginn des Plans
    const erster = (await db.eintraege.orderBy('datum').first()).datum;
    const letzter = (await db.eintraege.orderBy('datum').last()).datum;
    let ref = heuteStr();
    if (ref < erster || ref > letzter) ref = erster;
    state.jahr = +ref.slice(0, 4); state.monat = +ref.slice(5, 7);
  }
  zeichne();
}

function zeichneNav() {
  const punkte = [['kalender', 'Kalender'], ['typen', 'Schichttypen'], ['sicherung', 'Sicherung']];
  nav.innerHTML = punkte.map(([id, text]) => `<button data-seite="${id}" aria-current="${state.seite === id}">${text}</button>`).join('');
}

async function zeichne() {
  zeichneNav();
  if ((await db.eintraege.count()) === 0 && state.seite !== 'sicherung') return zeichneEinrichtung();
  if (state.seite === 'kalender') return zeichneKalender();
  if (state.seite === 'typen') return zeichneTypen();
  if (state.seite === 'sicherung') return zeichneSicherung();
}

// ---------------------------------------------------------------- Einrichtung
function zeichneEinrichtung() {
  app.innerHTML = `
    <h1>Einrichtung</h1>
    <p class="hinweis">Es ist noch kein Plan vorhanden. Wähle die beiden Turnus-Dateien von deinem Gerät aus. Sie werden nur in diesem Browser gespeichert.</p>
    <div class="box">
      <label for="f-schichten">Datei turnus_schichten.csv</label>
      <input id="f-schichten" type="file" accept=".csv,text/csv">
      <label for="f-wr">Datei turnus_wochenruhe.csv</label>
      <input id="f-wr" type="file" accept=".csv,text/csv">
      <label for="startdatum">Erster Tag (ein Montag)</label>
      <input id="startdatum" type="date" value="2026-12-14">
      <label for="startwoche">Turnus-Woche an diesem Tag</label>
      <input id="startwoche" type="number" min="1" max="31" value="27">
      <p class="hinweis">Der Plan umfasst 52 Wochen, der Turnus (31 Wochen) beginnt danach wieder von vorn.</p>
      <p><button class="knopf" id="plan-los">Plan erzeugen</button></p>
      <p class="hinweis" id="fehler"></p>
    </div>`;
  document.getElementById('plan-los').onclick = async () => {
    try {
      const fs = document.getElementById('f-schichten').files[0], fw = document.getElementById('f-wr').files[0];
      if (!fs || !fw) throw new Error('Bitte beide Dateien auswählen.');
      await turnusImportieren(db, await fs.text(), await fw.text(), '2026-12-13');
      await planErzeugen(db, document.getElementById('startdatum').value, +document.getElementById('startwoche').value, 52);
      await start();
    } catch (e) { document.getElementById('fehler').textContent = e.message; }
  };
}

// ---------------------------------------------------------------- Kalender
function monatWeiter(n) {
  let m = state.monat + n, j = state.jahr;
  while (m > 12) { m -= 12; j++; } while (m < 1) { m += 12; j--; }
  return [j, m];
}

async function zeichneKalender() {
  const [j2, m2] = monatWeiter(1);
  const [t1, t2] = await Promise.all([monatsDaten(db, state.jahr, state.monat), monatsDaten(db, j2, m2)]);
  const rendern = state.ansicht === 'raster' ? rasterHtml : listeHtml;
  app.innerHTML = `
    <div class="leiste">
      <button class="knopf" data-aktion="zurueck" aria-label="Ein Monat zurück">&lsaquo;</button>
      <button class="knopf" data-aktion="heute">Heute</button>
      <button class="knopf" data-aktion="vor" aria-label="Ein Monat vor">&rsaquo;</button>
      <span class="raum"></span>
      <button class="knopf" data-ansicht="liste" aria-pressed="${state.ansicht === 'liste'}">Liste</button>
      <button class="knopf" data-ansicht="raster" aria-pressed="${state.ansicht === 'raster'}">Raster</button>
    </div>
    <section class="monat"><h2>${MONATE[state.monat - 1]} ${state.jahr}</h2>${rendern(t1)}</section>
    <section class="monat"><h2>${MONATE[m2 - 1]} ${j2}</h2>${rendern(t2)}</section>`;
}

function zeiten(e) {
  return `${e.beginn}–${e.ende}${e.endeFolgetag ? ' (+1)' : ''}`;
}

function listeHtml(tage) {
  const heute = heuteStr();
  const zeilen = tage.map((t) => {
    const e = t.eintrag;
    const klassen = [e || !t.imPlan ? '' : 'frei', !t.imPlan ? 'frei' : '', t.wr.length ? 'wr' : '', t.reserve ? 'reserve' : '', t.wt === 0 ? 'woche' : '', t.datum === heute ? 'heute' : ''].join(' ');
    const hinweise = [t.reserve ? 'Reserve' : '', ...t.wr, t.fortsetzung ? `${t.fortsetzung.code} bis ${t.fortsetzung.ende}` : '', e && e.nrv ? 'NRV' : '', e && e.kategorie && e.kategorie !== 'geplant' ? e.kategorie : '']
      .filter(Boolean).join(' · ');
    return `<tr class="${klassen}">
      <td class="kein-umbruch">${t.wtName} ${zweiStellig(t.tag)}.${zweiStellig(+t.datum.slice(5, 7))}.${t.wt === 0 && t.turnusWoche ? `<div class="klein">Wo ${t.turnusWoche}</div>` : ''}</td>
      <td class="kein-umbruch">${e ? `<span class="code">${e.code}</span>` : (t.imPlan ? 'frei' : 'kein Plan')}</td>
      <td class="kein-umbruch">${e ? zeiten(e) : ''}</td>
      <td class="zahl">${e && e.baz ? e.baz : ''}</td>
      <td class="klein">${hinweise}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Tag</th><th>Schicht</th><th>Zeit</th><th class="zahl">bAZ</th><th>Hinweis</th></tr></thead><tbody>${zeilen}</tbody></table>`;
}

function rasterHtml(tage) {
  const heute = heuteStr();
  const kopf = TAGE.map((t) => `<div class="kopf">${t}</div>`).join('');
  const leer = '<div class="tag leer"></div>'.repeat(tage[0].wt);
  const zellen = tage.map((t) => {
    const e = t.eintrag;
    const klassen = ['tag', t.wr.length ? 'wr' : '', t.reserve ? 'reserve' : '', t.datum === heute ? 'heute' : ''].join(' ');
    return `<div class="${klassen}"><span class="nr">${t.tag}</span>
      ${t.fortsetzung ? `<div class="klein">${t.fortsetzung.code} bis ${t.fortsetzung.ende}</div>` : ''}
      ${e ? `<div class="code">${e.code}</div><div class="zeit">${e.beginn}–${e.ende}${e.endeFolgetag ? ' +1' : ''}</div>${e.nrv ? '<div class="klein">NRV</div>' : ''}` : ''}
      ${t.wr.map((w) => `<div class="klein">${w}</div>`).join('')}</div>`;
  }).join('');
  const rest = (7 - ((tage[0].wt + tage.length) % 7)) % 7;
  return `<div class="raster">${kopf}${leer}${zellen}${'<div class="tag leer"></div>'.repeat(rest)}</div>`;
}

// ---------------------------------------------------------------- Schichttypen
async function zeichneTypen() {
  const versionen = await db.schichtVersionen.toArray();
  versionen.sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }) || a.gueltigAb.localeCompare(b.gueltigAb));
  const zeilen = versionen.map((v) => `<tr class="${v.code.startsWith('6000') ? 'reserve' : ''}">
    <td class="code">${v.code}</td><td class="klein">ab ${v.gueltigAb.split('-').reverse().join('.')}</td>
    ${TAGE.map((_, i) => { const r = v.regeln[i]; return `<td>${r ? `${r.beginn}–${r.ende}` : '<span class="klein">–</span>'}</td>`; }).join('')}</tr>`).join('');
  app.innerHTML = `
    <h1>Schichttypen</h1>
    <p class="hinweis">Zeiten je Wochentag, wie sie im Turnus vorkommen. Ein Strich heißt: im Turnus nicht vorhanden. Bearbeiten kommt im nächsten Schritt.</p>
    <div style="overflow-x:auto"><table><thead><tr><th>Code</th><th>Gültig</th>${TAGE.map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${zeilen}</tbody></table></div>`;
}

// ---------------------------------------------------------------- Sicherung
async function zeichneSicherung() {
  const anz = { eintraege: await db.eintraege.count(), aenderungen: await db.aenderungen.count() };
  app.innerHTML = `
    <h1>Sicherung</h1>
    <p class="hinweis">Alle Daten liegen nur in diesem Browser. Speichere regelmäßig eine Sicherung, zum Beispiel in dein Google Drive.</p>
    <div class="box">
      <p>Gespeichert: ${anz.eintraege} Tage, ${anz.aenderungen} Einträge in der Änderungshistorie.</p>
      <p><button class="knopf" id="sichern">Sicherung speichern</button></p>
      <label for="datei">Sicherung zurückspielen (ersetzt alles hier)</label>
      <input id="datei" type="file" accept=".json,application/json">
      <p class="hinweis" id="meldung"></p>
    </div>`;
  document.getElementById('sichern').onclick = async () => {
    const obj = await sicherungErstellen(db);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' }));
    a.download = `dienstplan-sicherung-${heuteStr()}.json`; a.click();
  };
  document.getElementById('datei').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { await sicherungEinspielen(db, JSON.parse(await f.text())); document.getElementById('meldung').textContent = 'Sicherung eingespielt.'; await start(); state.seite = 'sicherung'; zeichne(); }
    catch (e) { document.getElementById('meldung').textContent = e.message; }
  };
}

// ---------------------------------------------------------------- Bedienung
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.seite) { state.seite = b.dataset.seite; zeichne(); }
  else if (b.dataset.ansicht) { state.ansicht = b.dataset.ansicht; zeichne(); }
  else if (b.dataset.aktion === 'vor') { [state.jahr, state.monat] = monatWeiter(1); zeichne(); }
  else if (b.dataset.aktion === 'zurueck') { [state.jahr, state.monat] = monatWeiter(-1); zeichne(); }
  else if (b.dataset.aktion === 'heute') { const h = heuteStr(); state.jahr = +h.slice(0, 4); state.monat = +h.slice(5, 7); zeichne(); }
});

start();
