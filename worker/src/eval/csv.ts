/**
 * Minimal CSV reader/writer for the phase-3 labeling workflow (worker/eval).
 *
 * Written in-repo (CONTEXT rule 1: no vendored sources): double-quoted
 * fields, "" escapes, CR/LF/CRLF line endings, multi-line quoted fields.
 * Lines starting with '#' outside a quoted field are comments (the labeling
 * instructions live there) and are skipped by the parser.
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

/** Parse CSV text into rows of cells. Throws CsvError on truncation. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordHasContent = false;
  let i = 0;

  const endField = (): void => {
    fields.push(field);
    field = "";
  };
  const endRecord = (): void => {
    if (recordHasContent || fields.length > 0) {
      endField();
      rows.push(fields);
      fields = [];
    }
    recordHasContent = false;
  };

  while (i < text.length) {
    const ch = text[i] as string;
    // Comment lines: '#' as the very first character of a record.
    if (
      !inQuotes &&
      !recordHasContent &&
      fields.length === 0 &&
      field === "" &&
      ch === "#"
    ) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          recordHasContent = true;
          continue;
        }
        inQuotes = false;
        i++;
        recordHasContent = true;
        continue;
      }
      field += ch;
      i++;
      recordHasContent = true;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      recordHasContent = true;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      recordHasContent = true;
      continue;
    }
    if (ch === "\r" && text[i + 1] === "\n") {
      endRecord();
      i += 2;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      endRecord();
      i++;
      continue;
    }
    field += ch;
    i++;
    recordHasContent = true;
  }
  if (inQuotes) {
    throw new CsvError("unterminated quoted field at end of input");
  }
  endRecord();
  return rows;
}

/** Serialize rows of cells. Quotes fields containing , " CR or LF. */
export function toCsv(rows: string[][]): string {
  return (
    rows
      .map((row) =>
        row
          .map((cell) => {
            if (/[",\r\n]/.test(cell)) {
              return `"${cell.replace(/"/g, '""')}"`;
            }
            return cell;
          })
          .join(","),
      )
      .join("\n") + "\n"
  );
}
