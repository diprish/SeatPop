/**
 * Lightweight PII redaction for untrusted typed text (phases 4-5).
 *
 * Applied before any model call on household descriptions and emails:
 * email addresses, phone numbers, and full postal codes are replaced
 * with placeholders. Names cannot be detected reliably, so the UI must
 * additionally warn users not to include them (and the raw text is
 * discarded after parsing — never stored or logged).
 */

/** Email addresses → [email]. */
export function redactEmails(text: string): string {
  return text.replace(
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    "[email]",
  );
}

/**
 * Phone numbers → [phone]. Matches North-American style digit runs with
 * separators (spaces, dashes, dots, parens): at least 10 digits total.
 * Short runs (ages, prices, years) are left alone.
 */
export function redactPhones(text: string): string {
  return text.replace(
    /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
    "[phone]",
  );
}

/**
 * Full Canadian postal codes → [postal code]. Forward sortation areas
 * (3 chars, e.g. K1S) are coarse enough to keep: only 6-character
 * codes are redacted.
 */
export function redactPostalCodes(text: string): string {
  return text.replace(
    /\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/g,
    "[postal code]",
  );
}

/** All three redactors, in a fixed order. */
export function redactPii(text: string): string {
  return redactPostalCodes(redactPhones(redactEmails(text)));
}

const STREET_SUFFIX =
  "St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Cres|Crescent|Ct|Court|Dr|Drive|Ln|Lane|Way|Pl|Place|Ter|Terrace";

/**
 * Street addresses → [address]. Number + capitalized words + a street
 * suffix ("123 Main St", "456 Oak Ave"). Unit markers ("Apt 4") are left
 * behind — harmless without the street. Venue names that look like
 * addresses ("10 Daly Ave") redact too: the venue is already known from
 * the event row, so no booking fact is lost.
 */
export function redactAddresses(text: string): string {
  return text.replace(
    new RegExp(
      `\\b\\d{1,5}\\s+[A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,3}\\s+(?:${STREET_SUFFIX})\\b\\.?`,
      "gi",
    ),
    "[address]",
  );
}

/** Confirmation-paste redaction: emails, phones, addresses, postals. */
export function redactBookingPii(text: string): string {
  return redactAddresses(redactPii(text));
}
