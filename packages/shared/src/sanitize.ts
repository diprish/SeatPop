/**
 * Listing-text sanitation (client-safe, shared by ingest and render).
 *
 * Fixes scraper damage: HTML entities, U+FFFD replacement chars and C1
 * controls, UTF-8-read-as-Latin-1 mojibake, and sentences glued without
 * spaces ("treats.Friday", "PMSaturday", "18:00Samedi"). Runs to a
 * fixpoint (max 3 passes) so storing the output is idempotent.
 *
 * Deliberately conservative: lowercase-to-lowercase glue ("receptionau")
 * is left alone — splitting it is never safe — and a bare U+FFFD is
 * removed rather than guessed (it could be à, –, or anything else).
 *
 * Discipline: every non-ASCII character below is built from numeric code
 * points (cp), never typed literally — several entries contain invisible
 * C1 controls where a literal would silently be the wrong character.
 */

const cp = (...codes: number[]): string => String.fromCodePoint(...codes);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  amp: "&",
};

function codePointOrEmpty(code: number): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Single entity level: numeric (&#038; &#x26;) then named. One regex pass
 * never decodes twice ("&amp;lt;" -> "&lt;"); the fixpoint converges
 * double-encoded input on the next pass.
 */
function decodeEntities(text: string): string {
  const numeric = text
    .replace(/&#(\d{1,7});/g, (_whole, digits: string) =>
      codePointOrEmpty(Number(digits)),
    )
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_whole, hex: string) =>
      codePointOrEmpty(Number.parseInt(hex, 16)),
    );
  return numeric.replace(/&([a-zA-Z]+);/g, (whole, name: string) => {
    const decoded = NAMED_ENTITIES[name];
    return decoded === undefined ? whole : decoded;
  });
}

/**
 * UTF-8 bytes misread as Latin-1, as [broken, fixed] code-point lists.
 * Every pair is unambiguous in French/English listing text. Applied
 * before the C1 strip, which would otherwise destroy the evidence; the
 * lone-C2 entry runs last so the C2-pairs match first.
 */
const MOJIBAKE: Array<[number[], number[]]> = [
  [[0xe2, 0x80, 0x99], [0x2019]], // right single quote
  [[0xe2, 0x80, 0x98], [0x2018]], // left single quote
  [[0xe2, 0x80, 0x9c], [0x201c]], // left double quote
  [[0xe2, 0x80, 0x9d], [0x201d]], // right double quote
  [[0xe2, 0x80, 0x94], [0x2014]], // em dash
  [[0xe2, 0x80, 0x93], [0x2013]], // en dash
  [[0xe2, 0x80, 0xa6], [0x2026]], // ellipsis
  [[0xc3, 0xa9], [0xe9]], // e-acute
  [[0xc3, 0xa8], [0xe8]], // e-grave
  [[0xc3, 0xaa], [0xea]], // e-circumflex
  [[0xc3, 0xab], [0xeb]], // e-diaeresis
  [[0xc3, 0xa0], [0xe0]], // a-grave
  [[0xc3, 0xa2], [0xe2]], // a-circumflex
  [[0xc3, 0xae], [0xee]], // i-circumflex
  [[0xc3, 0xaf], [0xef]], // i-diaeresis
  [[0xc3, 0xb4], [0xf4]], // o-circumflex
  [[0xc3, 0xb9], [0xf9]], // u-grave
  [[0xc3, 0xbb], [0xfb]], // u-circumflex
  [[0xc3, 0xa7], [0xe7]], // c-cedilla
  [[0xc3, 0x89], [0xc9]], // E-acute
  [[0xc3, 0x88], [0xc8]], // E-grave
  [[0xc3, 0x82], [0xc2]], // A-circumflex
  [[0xc2, 0xab], [0xab]], // left guillemet
  [[0xc2, 0xbb], [0xbb]], // right guillemet
  [[0xc2, 0xb0], [0xb0]], // degree sign
  [[0xc2, 0xa1], [0xa1]], // inverted !
  [[0xc2, 0xbf], [0xbf]], // inverted ?
  [[0xc2, 0xa0], [0x20]], // nbsp -> space
  [[0xc2], []], // stray artifact; must run after the C2-pairs above
];

function foldMojibake(text: string): string {
  let out = text;
  for (const [broken, fixed] of MOJIBAKE) {
    const needle = cp(...broken);
    if (out.includes(needle)) out = out.split(needle).join(cp(...fixed));
  }
  return out;
}

/** U+FFFD and leftover C1 controls are removed, never guessed. */
function stripControls(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0xfffd) continue;
    if (code >= 0x80 && code <= 0x9f) continue;
    out += char;
  }
  return out;
}

/**
 * Glued sentences, three safe splits only (the à-ÿ/À-Þ ranges are the
 * visible Latin-1 letters, typed literally):
 * - lowercase/digit + sentence punct + uppercase ("treats.Friday"),
 *   so "U.S.A" (uppercase before) and "3.5" (digit after) survive;
 * - acronym + capitalised word ("PMSaturday" -> "PM Saturday");
 * - digit + capitalised word ("18:00Samedi" -> "18:00 Samedi"),
 *   so "K2S" and "3D" (no lowercase tail) survive.
 */
function splitGlued(text: string): string {
  return text
    .replace(/([a-zà-ÿ0-9)])([.!?])([A-ZÀ-Þ])/g, "$1$2 $3")
    .replace(/([A-ZÀ-Þ]{2,})([A-ZÀ-Þ][a-zà-ÿ])/g, "$1 $2")
    .replace(/(\d)([A-ZÀ-Þ][a-zà-ÿ])/g, "$1 $2");
}

/** Collapse blank runs but keep newlines (descriptions may use them). */
function collapseWhitespace(text: string): string {
  const nbsp = cp(0xa0);
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line.split(nbsp).join(" ").replace(/[ \t\f\v]+/g, " ").trim(),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeOnce(text: string): string {
  return collapseWhitespace(
    splitGlued(stripControls(foldMojibake(decodeEntities(text)))),
  );
}

/** Full sanitation to a fixpoint (idempotent by construction). */
export function sanitizeText(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3; pass++) {
    const next = sanitizeOnce(out);
    if (next === out) return next;
    out = next;
  }
  return out;
}
