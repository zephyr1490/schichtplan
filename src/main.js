import { turnusDateiOeffnen } from './krypto.js';
import { createDb } from './db.js';
import { turnusImportieren, planErzeugen, eintragSetzen, eintragLoeschen, historie, wrAnteilBerechnen, zeitenVorschlag, folgetagKonflikt, planZuruecksetzen, allesLoeschen, wochenruhenFuerTag, wrVersetzen, historieEintragLoeschen } from './dienstplan.js';
import { monatsDaten } from './ansicht.js';
import { sicherungErstellen, sicherungEinspielen } from './sicherung.js';
import { TAGE, addTage, wochentag, hhmm, minuten, absMin } from './zeit.js';
import { auswertung, auswertungDrz, zeitraumFuer, hhmmMitZeichen } from './auswertung.js';

const db = createDb('dienstplan');
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const heuteStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const zweiStellig = (n) => String(n).padStart(2, '0');

const state = { modus: 'drz', dlgDatum: null, zeitraum: null, seite: 'kalender', ansicht: window.innerWidth > 720 ? 'raster' : 'liste', jahr: null, monat: null };

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
  const punkte = [['kalender', 'Kalender'], ['auswertung', 'Auswertung'], ['typen', 'Schichttypen'], ['historie', 'Historie'], ['sicherung', 'Sicherung']];
  nav.innerHTML = punkte.map(([id, text]) => `<button data-seite="${id}" aria-current="${state.seite === id}">${text}</button>`).join('');
}

async function zeichne() {
  zeichneNav();
  if ((await db.eintraege.count()) === 0 && state.seite !== 'sicherung') return zeichneEinrichtung();
  if (state.seite === 'kalender') return zeichneKalender();
  if (state.seite === 'auswertung') return zeichneAuswertung();
  if (state.seite === 'typen') return zeichneTypen();
  if (state.seite === 'historie') return zeichneHistorie();
  if (state.seite === 'sicherung') return zeichneSicherung();
}

// ---------------------------------------------------------------- Einrichtung
function zeichneEinrichtung() {
  app.innerHTML = `
    <h1>Einrichtung</h1>
    <p class="hinweis">Es ist noch kein Plan vorhanden. Gib deine Dienstnummer ein, dann wird dein Plan eingerichtet. Die Nummer wird nicht gespeichert, der Plan nur in diesem Browser.</p>
    <div class="box">
      <label for="dnr">Dienstnummer (6 Ziffern)</label>
      <input id="dnr" type="text" inputmode="numeric" autocomplete="off" maxlength="6">
      <p><button class="knopf" id="plan-los">Plan erzeugen</button></p>
      <p class="hinweis" id="fehler"></p>
    </div>
    <details class="box">
      <summary>Stattdessen eigene Dateien verwenden</summary>
      <label for="f-schichten">Datei turnus_schichten.csv</label>
      <input id="f-schichten" type="file" accept=".csv,text/csv">
      <label for="f-wr">Datei turnus_wochenruhe.csv</label>
      <input id="f-wr" type="file" accept=".csv,text/csv">
      <label for="startdatum">Erster Tag (ein Montag)</label>
      <input id="startdatum" type="date" value="2026-12-14">
      <label for="startwoche">Turnus-Woche an diesem Tag</label>
      <input id="startwoche" type="number" min="1" max="31" value="27">
      <p><button class="knopf" id="plan-datei">Plan aus Dateien erzeugen</button></p>
    </details>`;
  const fehler = (t) => { document.getElementById('fehler').textContent = t; };
  document.getElementById('plan-los').onclick = async () => {
    try {
      fehler('');
      const nr = document.getElementById('dnr').value.trim();
      if (!/^\d{6}$/.test(nr)) throw new Error('Bitte die 6-stellige Dienstnummer eingeben.');
      fehler('Einen Moment bitte …');
      const antwort = await fetch('turnus.enc.json', { cache: 'no-cache' });
      if (!antwort.ok) throw new Error('Die Turnus-Datei konnte nicht geladen werden (Internet nötig).');
      const t = await turnusDateiOeffnen(await antwort.json(), nr);
      if (!t) throw new Error('Diese Dienstnummer ist nicht bekannt.');
      await turnusImportieren(db, t.schichtenCsv, t.wrCsv, t.gueltigAb);
      await planErzeugen(db, t.planStart, t.woche, 52);
      await start();
    } catch (e) { fehler(e.message); }
  };
  document.getElementById('plan-datei').onclick = async () => {
    try {
      const fs = document.getElementById('f-schichten').files[0], fw = document.getElementById('f-wr').files[0];
      if (!fs || !fw) throw new Error('Bitte beide Dateien auswählen.');
      await turnusImportieren(db, await fs.text(), await fw.text(), '2026-12-13');
      await planErzeugen(db, document.getElementById('startdatum').value, +document.getElementById('startwoche').value, 52);
      await start();
    } catch (e) { fehler(e.message); }
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
  if (e.ruhe) return 'Ruhe (kein Dienst)';
  return `${e.beginn}–${e.ende}${e.endeFolgetag ? ' (+1)' : ''}`;
}

function listeHtml(tage) {
  const heute = heuteStr();
  const zeilen = tage.map((t) => {
    const e = t.eintrag;
    const klassen = [e || !t.imPlan ? '' : 'frei', !t.imPlan ? 'frei' : '', t.wr.length ? 'wr' : '', t.reserve ? 'reserve' : '', t.wt === 0 ? 'woche' : '', t.datum === heute ? 'heute' : ''].join(' ');
    const hinweise = [t.reserve ? 'Reserve' : '', ...t.wr, t.fortsetzung ? `${t.fortsetzung.code} bis ${t.fortsetzung.ende}` : '', e && e.nrv ? 'NRV' : '', e && e.kategorie && e.kategorie !== 'geplant' ? e.kategorie : '']
      .filter(Boolean).join(' · ');
    return `<tr class="${klassen}"${t.imPlan ? ` data-datum="${t.datum}"` : ''}>
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
    return `<div class="${klassen}"${t.imPlan ? ` data-datum="${t.datum}"` : ''}><span class="nr">${t.tag}</span>
      ${t.fortsetzung ? `<div class="klein">${t.fortsetzung.code} bis ${t.fortsetzung.ende}</div>` : ''}
      ${e ? `<div class="code">${e.code}</div>${e.ruhe ? '' : `<div class="zeit">${e.beginn}–${e.ende}${e.endeFolgetag ? ' +1' : ''}</div>`}${e.nrv ? '<div class="klein">NRV</div>' : ''}` : ''}
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



// ---------------------------------------------------------------- Auswertung
const kurz = (d) => `${d.slice(8)}.${d.slice(5, 7)}.`;
async function zeichneAuswertung() {
  const heute = heuteStr();
  if (!state.zeitraum) {
    const erster = (await db.eintraege.orderBy('datum').first()).datum;
    const letzter = (await db.eintraege.orderBy('datum').last()).datum;
    state.zeitraum = zeitraumFuer(heute < erster || heute > letzter ? erster : heute);
  }
  const kw = state.modus === 'kw';
  const a = await (kw ? auswertung : auswertungDrz)(db, state.zeitraum.von, state.zeitraum.bis, heute);
  const zeile = (name, z) => z ? `<tr><td>${name}</td><td class="zahl">${hhmm(Math.round(z.ist))}</td><td class="zahl">${hhmm(Math.round(z.soll))}</td><td class="zahl"><b>${hhmmMitZeichen(Math.round(z.saldo))}</b></td></tr>` : '';
  app.innerHTML = `
    <h1>Auswertung</h1>
    <div class="leiste">
      <button class="knopf" data-modus="drz" aria-pressed="${!kw}">Durchrechnung (Monate)</button>
      <button class="knopf" data-modus="kw" aria-pressed="${kw}">Kalenderwochen</button>
    </div>
    <div class="leiste">
      <button class="knopf" data-zeitraum="-1" aria-label="Voriger Zeitraum">&lsaquo;</button>
      <b>${MONATE[+state.zeitraum.von.slice(5, 7) - 1]} und ${MONATE[+state.zeitraum.bis.slice(5, 7) - 1]} ${state.zeitraum.bis.slice(0, 4)}</b>
      <button class="knopf" data-zeitraum="1" aria-label="Nächster Zeitraum">&rsaquo;</button>
    </div>
    <p class="hinweis">${kw
      ? `Ganze Kalenderwochen ${kurz(a.anzeigeVon)}${a.anzeigeVon.slice(0, 4)} bis ${kurz(a.anzeigeBis)}${a.anzeigeBis.slice(0, 4)} (${a.wochenImZeitraum} Wochen). Eine Woche gehört zu dem Zeitraum, in dem ihr Donnerstag liegt.${a.teilweise ? ' Nur ' + a.wochen.length + ' davon liegen im Plan, nur diese werden gerechnet.' : ''}`
      : `Durchrechnungszeitraum ${kurz(a.anzeigeVon)}${a.anzeigeVon.slice(0, 4)} bis ${kurz(a.anzeigeBis)}${a.anzeigeBis.slice(0, 4)} (${a.tageImZeitraum} Tage). Soll: 5:30 je Tag. Wochen am Rand sind Teilwochen.${a.teilweise ? ' Nur ' + a.planTage + ' Tage liegen im Plan, nur diese werden gerechnet.' : ''}`}</p>
    ${a.wochen.length ? `<table><thead><tr><th></th><th class="zahl">Ist (bAZ)</th><th class="zahl">Soll</th><th class="zahl">Saldo</th></tr></thead><tbody>
      ${zeile('Bis gestern', a.bisHeute)}${zeile('Ganzer Zeitraum (laut Plan)', a.gesamt)}</tbody></table>
    ${a.reserve.anzahl ? `<p class="hinweis">Darin sind ${a.reserve.anzahl} Reserve-Dienste (Platzhalter) mit zusammen ${hhmm(a.reserve.min)} enthalten. Die echten Dienste sind meist länger.</p>` : ''}
    <h2>Pro Woche</h2>
    <table><thead><tr><th>Woche</th><th class="zahl">Ist</th><th class="zahl">Soll</th><th class="zahl">${kw ? '+/− zu 38:30' : '+/− zum Soll'}</th><th class="zahl">Saldo gesamt</th></tr></thead><tbody>
      ${a.wochen.map((w) => `<tr><td class="kein-umbruch">${kurz(w.von)}–${kurz(w.bis)}${w.teilwoche ? ` (${w.tage} Tage)` : ''}</td><td class="zahl">${hhmm(Math.round(w.ist))}</td><td class="zahl">${hhmm(Math.round(w.soll))}</td><td class="zahl">${hhmmMitZeichen(Math.round(w.saldo))}</td><td class="zahl">${hhmmMitZeichen(Math.round(w.kumuliert))}</td></tr>`).join('')}</tbody></table>` : '<p>In diesem Zeitraum gibt es noch keinen Plan.</p>'}
    <p class="hinweis">Alle Werte in Stunden:Minuten (324:30 = 324 Stunden 30 Minuten). Soll: 38,5 Stunden pro Woche, das sind 38 Stunden 30 Minuten. Ist: nur die bAZ aus dem Plan, ohne Fahrzeit (FZ) und Nachtfaktor (NF). Urlaub, Krankenstand, Feiertage und Zulagen sind noch nicht berücksichtigt.</p>`;
}

// ---------------------------------------------------------------- Tag bearbeiten
const KATEGORIEN = [['geplant', 'Geplant'], ['aenderung', 'Änderung'], ['zusatzschicht', 'Zusatzschicht']];
const fmtZeitpunkt = (iso) => { const d = new Date(iso); return `${zweiStellig(d.getDate())}.${zweiStellig(d.getMonth() + 1)}.${d.getFullYear()} ${zweiStellig(d.getHours())}:${zweiStellig(d.getMinutes())}`; };
const beschr = (x) => (!x ? 'frei' : x.ruhe ? `Ruhe${x.nrv ? ' NRV' : ''}` : `${x.code} ${x.beginn}–${x.ende}${x.nrv ? ' NRV' : ''}`);
const datumKurz = (d) => `${TAGE[wochentag(d)]} ${d.slice(8)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

const wrZeit = (t) => `${TAGE[wochentag(t.slice(0, 10))]} ${t.slice(8, 10)}.${t.slice(5, 7)}. ${t.slice(11)}`;
const wrText = (w) => `${wrZeit(w.start)} – ${wrZeit(w.ende)}`;
const aenderungText = (h) => (h.art === 'wr' ? `WR ${wrText(h.alt)} &rarr; ${wrText(h.neu)}` : `${beschr(h.alt)} &rarr; ${beschr(h.neu)}`) + (h.grund ? ` <span class="klein">(${h.grund})</span>` : '');
const loeschKnopf = (h) => `<button class="knopf klein-knopf" type="button" data-hdel="${h.id}">löschen</button>`;

async function oeffneTag(datum) {
  state.dlgDatum = datum;
  const dlg = document.getElementById('dlg');
  const e = await db.eintraege.get(datum);
  const wrs = await db.wochenruhen.toArray();
  const codes = (await db.schichtTypen.toArray()).map((t) => t.code).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  const hist = await historie(db, datum);
  const wrListe = await wochenruhenFuerTag(db, datum);
  dlg.innerHTML = `
    <form method="dialog" id="tagform">
      <h2 style="margin-top:0">${datumKurz(datum)}</h2>
      <p class="hinweis">Jetzt: ${e ? beschr(e) : 'frei'}</p>
      <label for="f-code">Schicht</label>
      <input id="f-code" list="codes" value="${e && !e.ruhe ? e.code : ''}" autocomplete="off">
      <datalist id="codes">${codes.map((c) => `<option value="${c}">`).join('')}</datalist>
      <div class="zeile">
        <div><label for="f-beginn">Beginn</label><input id="f-beginn" type="time" value="${e && e.beginn ? e.beginn : ''}"></div>
        <div><label for="f-ende">Ende</label><input id="f-ende" type="time" value="${e && e.ende ? e.ende : ''}"></div>
        <div><label for="f-baz">bAZ (h:mm)</label><input id="f-baz" type="text" inputmode="numeric" placeholder="z.B. 11:13" value="${e && e.baz ? e.baz : ''}" size="6"></div>
      </div>
      <p class="klein" id="f-info"></p>
      <label for="f-kat">Art</label>
      <select id="f-kat">${KATEGORIEN.map(([k, t]) => `<option value="${k}"${(e ? e.kategorie : 'zusatzschicht') === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
      <label class="check"><input id="f-nrv" type="checkbox"${e && e.nrv ? ' checked' : ''}> NRV (nicht rechtzeitig verständigt)</label>
      <p id="f-wr" class="wrhinweis"></p>
      <p id="f-folge" class="klein"></p>
      <p id="f-fehler" class="klein"></p>
      <div class="leiste">
        <button class="knopf" id="f-speichern" type="button">Speichern</button>
        <button class="knopf" id="f-ruhe" type="button">Als Ruhe eintragen</button>
        <button class="knopf" id="f-abbrechen" type="button">Abbrechen</button>
        <span class="raum"></span>
        ${e ? '<button class="knopf" id="f-loeschen" type="button">Dienst entfernen</button>' : ''}
      </div>
    </form>
    ${wrListe.length ? `<h2>Wochenruhe an diesem Tag</h2><p class="klein">Eine WR kann ausnahmsweise verschoben werden, zum Beispiel wenn du einem Dienst darin zustimmst.</p>${wrListe.map((w) => `
      <div class="box wrbox" data-wrid="${w.id}">
        <p class="klein">WR ${wrText(w)} (${hhmm(absMin(w.ende.slice(0, 10), w.ende.slice(11)) - absMin(w.start.slice(0, 10), w.start.slice(11)))}h)</p>
        <div class="zeile"><div><label>Start</label><input type="date" class="wr-sd" value="${w.start.slice(0, 10)}"><input type="time" class="wr-sz" value="${w.start.slice(11)}"></div>
        <div><label>Ende</label><input type="date" class="wr-ed" value="${w.ende.slice(0, 10)}"><input type="time" class="wr-ez" value="${w.ende.slice(11)}"></div></div>
        <p><button class="knopf wr-speichern" type="button">WR versetzen</button> <span class="klein wr-meldung"></span></p>
      </div>`).join('')}` : ''}
    <h2>Änderungen an diesem Tag</h2>
    ${hist.length ? `<table><tbody>${hist.map((h) => `<tr><td class="kein-umbruch klein">${fmtZeitpunkt(h.zeitstempel)}</td><td>${aenderungText(h)}</td><td>${loeschKnopf(h)}</td></tr>`).join('')}</tbody></table>` : '<p class="klein">Noch keine.</p>'}`;

  const el = (id) => document.getElementById(id);
  const orig = e && !e.ruhe ? { code: e.code, beginn: e.beginn, ende: e.ende, baz: e.baz ?? '' } : null;
  let zeitenAngefasst = false;

  const wrHinweis = async () => {
    const b = el('f-beginn').value, en = el('f-ende').value;
    el('f-folge').textContent = '';
    if (!b || !en) { el('f-wr').textContent = ''; el('f-info').textContent = ''; return; }
    const k = await folgetagKonflikt(db, datum, { beginn: b, ende: en });
    if (k) el('f-folge').textContent = k.reserve
      ? `Hinweis: Der Reserve-Dienst am Folgetag (${k.eintrag.code}, ${k.eintrag.beginn}–${k.eintrag.ende}) fällt in diesen Dienst und wird beim Speichern entfernt.`
      : `Achtung: Überschneidung mit ${k.eintrag.code} am Folgetag (${k.eintrag.beginn}–${k.eintrag.ende}).`;
    const r = wrAnteilBerechnen(wrs, datum, b, en);
    el('f-info').textContent = minuten(en) < minuten(b) ? 'Endet am Folgetag.' : '';
    el('f-wr').textContent = r.inWr ? `${hhmm(r.inWr)}h in der WR (${hhmm(r.ausserhalb)}h außerhalb)` : '';
  };
  const artAnpassen = () => {
    if (!orig || el('f-kat').value !== 'geplant') return;
    if (el('f-code').value !== orig.code || el('f-beginn').value !== orig.beginn || el('f-ende').value !== orig.ende) el('f-kat').value = 'aenderung';
  };
  el('f-code').addEventListener('change', async () => {
    const code = el('f-code').value.trim();
    if (!zeitenAngefasst && code) {
      const v = await zeitenVorschlag(db, code, datum);
      if (v) { el('f-beginn').value = v.beginn; el('f-ende').value = v.ende; el('f-baz').value = v.baz ?? ''; el('f-fehler').textContent = 'Zeiten aus dem Schichttyp übernommen.'; }
      else el('f-fehler').textContent = 'Für diese Schicht an diesem Wochentag sind keine Zeiten bekannt. Bitte selbst eintragen.';
    }
    artAnpassen(); wrHinweis();
  });
  for (const id of ['f-beginn', 'f-ende', 'f-baz']) el(id).addEventListener('input', () => { zeitenAngefasst = true; artAnpassen(); wrHinweis(); });
  wrHinweis();

  el('f-abbrechen').onclick = () => dlg.close();
  el('f-ruhe').onclick = async () => {
    await eintragSetzen(db, datum, { ruhe: true, nrv: el('f-nrv').checked, kategorie: el('f-kat').value === 'geplant' ? 'aenderung' : el('f-kat').value });
    dlg.close(); zeichne();
  };
  el('f-speichern').onclick = async () => {
    const code = el('f-code').value.trim(), beginn = el('f-beginn').value, ende = el('f-ende').value;
    if (!code || !beginn || !ende) { el('f-fehler').textContent = 'Schicht, Beginn und Ende werden benötigt.'; return; }
    const baz = el('f-baz').value.trim();
    if (baz && !/^\d{1,2}:[0-5]\d$/.test(baz)) { el('f-fehler').textContent = 'bAZ bitte als h:mm eintragen, z.B. 11:13.'; return; }
    const nrv = el('f-nrv').checked, kategorie = el('f-kat').value;
    if (e && e.code === code && e.beginn === beginn && e.ende === ende && (e.baz ?? '') === baz && e.kategorie === kategorie && !!e.nrv === nrv) { dlg.close(); return; }
    await eintragSetzen(db, datum, { code, beginn, ende, baz: baz || null, kategorie, nrv });
    dlg.close(); zeichne();
  };
  if (e) {
    let sicher = false;
    el('f-loeschen').onclick = async () => {
      if (!sicher) { sicher = true; el('f-loeschen').textContent = 'Wirklich entfernen?'; return; }
      await eintragLoeschen(db, datum); dlg.close(); zeichne();
    };
  }
  dlg.querySelectorAll('.wrbox').forEach((box) => {
    box.querySelector('.wr-speichern').onclick = async () => {
      const g = (c) => box.querySelector(c).value;
      try {
        await wrVersetzen(db, +box.dataset.wrid, { start: `${g('.wr-sd')} ${g('.wr-sz')}`.trim(), ende: `${g('.wr-ed')} ${g('.wr-ez')}`.trim() });
        dlg.close(); zeichne();
      } catch (err) { box.querySelector('.wr-meldung').textContent = err.message; }
    };
  });
  dlg.showModal();
}

// ---------------------------------------------------------------- Historie
async function zeichneHistorie() {
  const alle = (await historie(db)).reverse();
  app.innerHTML = `
    <h1>Historie</h1>
    <p class="hinweis">Jede Änderung wird hier festgehalten und nie überschrieben. Neueste zuerst. Löschen entfernt nur den Protokolleintrag, die Änderung selbst bleibt bestehen.</p>
    ${alle.length ? `<table><thead><tr><th>Zeitpunkt</th><th>Tag</th><th>Änderung</th><th></th></tr></thead><tbody>
      ${alle.map((h) => `<tr><td class="kein-umbruch klein">${fmtZeitpunkt(h.zeitstempel)}</td><td class="kein-umbruch">${datumKurz(h.datum)}</td><td>${aenderungText(h)}</td><td>${loeschKnopf(h)}</td></tr>`).join('')}</tbody></table>` : '<p>Noch keine Änderungen.</p>'}
    <h2>Zurücksetzen (nur zum Testen)</h2>
    <div class="box">
      <p class="hinweis">Löscht die gesamte Historie und damit den Nachweis. Später wird dieser Bereich entfernt oder versteckt.</p>
      <p><button class="knopf" data-reset="plan">Plan neu aus dem Turnus erzeugen und Historie löschen</button></p>
      <p><button class="knopf" data-reset="alles">Alles löschen (zurück zur Einrichtung)</button></p>
    </div>`;
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
  const b = ev.target.closest('button');
  if (!b) { const z = ev.target.closest('[data-datum]'); if (z && state.seite === 'kalender') oeffneTag(z.dataset.datum); return; }
  if (b.dataset.seite) { state.seite = b.dataset.seite; zeichne(); }
  else if (b.dataset.zeitraum) { const z = state.zeitraum; const n = +b.dataset.zeitraum; const t = n > 0 ? addTage(z.bis, 1) : addTage(z.von, -1); state.zeitraum = zeitraumFuer(t); zeichne(); }
  else if (b.dataset.modus) { state.modus = b.dataset.modus; zeichne(); }
  else if (b.dataset.hdel) {
    if (b.dataset.sicher !== '1') { b.dataset.sicher = '1'; b.textContent = 'sicher?'; return; }
    historieEintragLoeschen(db, +b.dataset.hdel).then(() => { const dlg = document.getElementById('dlg'); if (dlg.open) oeffneTag(state.dlgDatum); else zeichne(); });
  }
  else if (b.dataset.reset) {
    if (b.dataset.sicher !== '1') { b.dataset.sicher = '1'; b.textContent = 'Wirklich? Noch einmal tippen zum Bestätigen'; return; }
    (b.dataset.reset === 'plan' ? planZuruecksetzen(db) : allesLoeschen(db)).then(() => { state.zeitraum = null; state.seite = b.dataset.reset === 'plan' ? 'historie' : 'kalender'; start(); });
  }
  else if (b.dataset.ansicht) { state.ansicht = b.dataset.ansicht; zeichne(); }
  else if (b.dataset.aktion === 'vor') { [state.jahr, state.monat] = monatWeiter(1); zeichne(); }
  else if (b.dataset.aktion === 'zurueck') { [state.jahr, state.monat] = monatWeiter(-1); zeichne(); }
  else if (b.dataset.aktion === 'heute') { const h = heuteStr(); state.jahr = +h.slice(0, 4); state.monat = +h.slice(5, 7); zeichne(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
