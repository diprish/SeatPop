import { describe, expect, it } from "vitest";
import { sanitizeText } from "../src/sanitize";

/** Invisible characters are built, never typed (see sanitize.ts). */
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
const FFFD = cp(0xfffd);

// Verbatim shape of the Ruth E. Dickinson Halloween description (live row:
// entities, U+FFFD where à/– were lost, sentences glued without spaces).
// Fixture uses single spaces around each FFFD; the sanitizer collapses
// blank runs either way.
const RUTH_RAW =
  "Show off your Halloween costume at the Ruth E. Dickinson branch! " +
  "Come to the 1st and 2nd floor circulation desks to pick your treats." +
  "Friday, October 30 from 10:00 AM to 6:00 PMSaturday, October 31 from " +
  "10:00 AM to 5:00 PMAges 0-12. Drop-in." +
  "Présente fièrement ton costume d'Halloween " +
  FFFD +
  " la succursale Ruth E. Dickinson! N'oublie pas de passer par la " +
  "receptionau premier ou au deuxième étage pour recevoir tes " +
  "friandises.Vendredi le 30 octobre, de 10:00 " +
  FFFD +
  " 18:00Samedi le 31 octobre, de 10:00 " +
  FFFD +
  " 17:00Pour les 0 " +
  FFFD +
  " &nbsp;12 ans. Portes ouvertes.";

const RUTH_CLEAN =
  "Show off your Halloween costume at the Ruth E. Dickinson branch! " +
  "Come to the 1st and 2nd floor circulation desks to pick your treats. " +
  "Friday, October 30 from 10:00 AM to 6:00 PM Saturday, October 31 from " +
  "10:00 AM to 5:00 PM Ages 0-12. Drop-in. " +
  "Présente fièrement ton costume d'Halloween la succursale Ruth E. " +
  "Dickinson! N'oublie pas de passer par la receptionau premier ou au " +
  "deuxième étage pour recevoir tes friandises. Vendredi le 30 octobre, " +
  "de 10:00 18:00 Samedi le 31 octobre, de 10:00 17:00 Pour les 0 12 " +
  "ans. Portes ouvertes.";

describe("sanitizeText", () => {
  it("cleans the Ruth E. Dickinson description end to end", () => {
    expect(sanitizeText(RUTH_RAW)).toBe(RUTH_CLEAN);
  });

  it("leaves unsafe lowercase glue alone", () => {
    expect(sanitizeText(RUTH_RAW)).toContain("receptionau premier");
  });

  it("decodes named, decimal, and hex entities", () => {
    expect(sanitizeText("Fish &amp; Chips")).toBe("Fish & Chips");
    expect(sanitizeText("a&nbsp;b")).toBe("a b");
    expect(sanitizeText("&#038;")).toBe("&");
    expect(sanitizeText("&#x26;")).toBe("&");
    expect(sanitizeText("&lt;tag&gt; &quot;q&quot; &#39;")).toBe(
      "<tag> \"q\" '",
    );
    expect(sanitizeText("R&D stays")).toBe("R&D stays");
    expect(sanitizeText("&bogus; stays")).toBe("&bogus; stays");
  });

  it("converges double-encoded entities to a fixpoint", () => {
    expect(sanitizeText("&amp;lt;")).toBe("<");
  });

  it("drops invalid numeric entities", () => {
    expect(sanitizeText("a&#0;b")).toBe("ab");
    expect(sanitizeText("a&#xD800;b")).toBe("ab");
    expect(sanitizeText("a&#x110000;b")).toBe("ab");
  });

  it("removes U+FFFD and C1 controls without guessing", () => {
    expect(sanitizeText(`a${FFFD}b`)).toBe("ab");
    expect(sanitizeText(`a${cp(0x85)}b`)).toBe("ab");
    expect(sanitizeText(`Halloween ${FFFD} la`)).toBe("Halloween la");
  });

  it("folds UTF-8-as-Latin-1 mojibake", () => {
    expect(sanitizeText(`d${cp(0xe2, 0x80, 0x99)}Halloween`)).toBe(
      "d’Halloween",
    );
    expect(sanitizeText(`${cp(0xe2, 0x80, 0x9c)}Hi${cp(0xe2, 0x80, 0x9d)}`)).toBe(
      "“Hi”",
    );
    expect(sanitizeText(`caf${cp(0xc3, 0xa9)}`)).toBe("café");
    expect(sanitizeText(`10${cp(0xc2, 0xb0)}C`)).toBe("10°C");
    expect(sanitizeText(`a${cp(0xc2, 0xa0)}b`)).toBe("a b");
  });

  it("splits glued sentences only where safe", () => {
    expect(sanitizeText("treats.Friday")).toBe("treats. Friday");
    expect(sanitizeText("6:00 PMSaturday")).toBe("6:00 PM Saturday");
    expect(sanitizeText("18:00Samedi")).toBe("18:00 Samedi");
    expect(sanitizeText("(see note).Next")).toBe("(see note). Next");
    // Safe skips: abbreviations, postals, decimals, spaced text, lowercase.
    expect(sanitizeText("U.S. Open")).toBe("U.S. Open");
    expect(sanitizeText("K2S area")).toBe("K2S area");
    expect(sanitizeText("3.5 stars")).toBe("3.5 stars");
    expect(sanitizeText("end. Already spaced")).toBe("end. Already spaced");
    expect(sanitizeText("receptionau premier")).toBe("receptionau premier");
    expect(sanitizeText("d'Halloween")).toBe("d'Halloween");
  });

  it("collapses blank runs but keeps newlines", () => {
    expect(sanitizeText("a   b")).toBe("a b");
    expect(sanitizeText("  padded  ")).toBe("padded");
    expect(sanitizeText("Line one\nLine two")).toBe("Line one\nLine two");
    expect(sanitizeText("a\n\n\nb")).toBe("a\n\nb");
  });

  it("is idempotent on a composite nasty string", () => {
    const nasty =
      `A${cp(0xe2, 0x80, 0x99)}b &amp; c${FFFD}d.E${cp(0xc3, 0xa9)}f  ` +
      `&nbsp;10${cp(0xc2, 0xb0)}C${cp(0x85)}`;
    const once = sanitizeText(nasty);
    expect(sanitizeText(once)).toBe(once);
    expect(once).toBe("A’b & cd. Eéf 10°C");
  });
});
