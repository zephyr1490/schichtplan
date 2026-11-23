// Kleine Hilfsfunktionen für Datum und Uhrzeit (alles als lokale Wanduhrzeit).
export const TAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const minuten = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const hhmm = (min) => {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${sign}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
};

// 'YYYY-MM-DD' -> Tage seit 1970 (ohne Zeitzonen-/Sommerzeit-Probleme)
export const tageNr = (datum) => {
  const [y, m, d] = datum.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
export const datumAusTageNr = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
export const addTage = (datum, n) => datumAusTageNr(tageNr(datum) + n);

// 0 = Montag ... 6 = Sonntag
export const wochentag = (datum) => (tageNr(datum) + 3) % 7;

// Absolute Minute seit 1970 für Datum + 'HH:MM'
export const absMin = (datum, zeit) => tageNr(datum) * 1440 + minuten(zeit);
export const absMinAusTag = (datum, minImTag) => tageNr(datum) * 1440 + minImTag;
export const parseCsv = (text) =>
  text.trim().split(/\r?\n/).slice(1).map((z) => z.split(';'));
