// Verschlüsselte Turnus-Datei: Schlüssel aus der Dienstnummer, nur WebCrypto (Browser und Node).
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const ITER = 300000;

async function schluesselAusNummer(nummer, salt, iter) {
  const roh = await crypto.subtle.importKey('raw', enc.encode(String(nummer).trim()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, roh,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function verschluesseln(key, daten) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(daten)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function entschluesseln(key, { iv, ct }) {
  const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct));
  return JSON.parse(dec.decode(klar));
}

// mitarbeiter: [{nummer: 27, dienstnummer: '123456'}], inhalt: {gueltigAb, planStart, schichtenCsv, wrCsv}
export async function turnusDateiErzeugen(mitarbeiter, inhalt) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const datenKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const datenRoh = b64(await crypto.subtle.exportKey('raw', datenKey));
  const daten = await verschluesseln(datenKey, inhalt);
  const zugaenge = [];
  for (const m of mitarbeiter) {
    const k = await schluesselAusNummer(m.dienstnummer, salt, ITER);
    zugaenge.push(await verschluesseln(k, { woche: m.nummer, datenKey: datenRoh }));
  }
  for (let i = zugaenge.length - 1; i > 0; i--) { // Reihenfolge mischen, sie verrät sonst die Woche
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [zugaenge[i], zugaenge[j]] = [zugaenge[j], zugaenge[i]];
  }
  return { v: 1, iter: ITER, salt: b64(salt), zugaenge, daten };
}

// liefert {woche, gueltigAb, planStart, schichtenCsv, wrCsv} oder null, wenn die Nummer unbekannt ist
export async function turnusDateiOeffnen(datei, dienstnummer) {
  const k = await schluesselAusNummer(dienstnummer, unb64(datei.salt), datei.iter);
  for (const z of datei.zugaenge) {
    let kopf;
    try { kopf = await entschluesseln(k, z); } catch { continue; }
    const dk = await crypto.subtle.importKey('raw', unb64(kopf.datenKey), 'AES-GCM', false, ['decrypt']);
    return { woche: kopf.woche, ...(await entschluesseln(dk, datei.daten)) };
  }
  return null;
}
