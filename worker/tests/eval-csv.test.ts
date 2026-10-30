import { describe, expect, it } from "vitest";
import { CsvError, parseCsv, toCsv } from "../src/eval/csv";

describe("eval csv", () => {
  it("parses simple rows with and without a trailing newline", () => {
    expect(parseCsv("a,b\nc,d\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b")).toEqual([["a", "b"]]);
    expect(parseCsv("")).toEqual([]);
  });

  it("handles quotes, escaped quotes, and multi-line fields", () => {
    expect(parseCsv('a,"b,c"\n')).toEqual([["a", "b,c"]]);
    expect(parseCsv('"a""b",c\n')).toEqual([['a"b', "c"]]);
    expect(parseCsv('a,"b\nc",d\n')).toEqual([["a", "b\nc", "d"]]);
  });

  it("handles CRLF and lone CR endings", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseCsv("a,b\rc,d\r")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("skips # comment lines but keeps # inside records", () => {
    expect(parseCsv("# rule: label only\n# more\na,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a#b,c\n")).toEqual([["a#b", "c"]]);
    expect(parseCsv("a,#b\n")).toEqual([["a", "#b"]]);
  });

  it("throws on an unterminated quoted field", () => {
    expect(() => parseCsv('"abc')).toThrow(CsvError);
  });

  it("serializes quoting only when needed", () => {
    expect(
      toCsv([
        ["a", "b,c"],
        ['d"e', "f\ng"],
        ["plain", ""],
      ]),
    ).toBe('a,"b,c"\n"d""e","f\ng"\nplain,\n');
  });

  it("round-trips through parse and serialize", () => {
    const rows = [
      ["e1", "Title, with comma", 'quote "here"\nand newline'],
      ["e2", "", "plain"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
