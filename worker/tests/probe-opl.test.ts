import { describe, expect, it } from "vitest";
import {
  parseDisplaying,
  parseEventLinkTitles,
  parseFilterForm,
  pickFilterCandidates,
  realOptions,
} from "../src/ingest/probe-opl";

describe("probe:opl parsers", () => {
  it("reads the Displaying line", () => {
    expect(parseDisplaying("Displaying 1 - 20 of 565")).toEqual({
      from: 1,
      to: 20,
      of: 565,
    });
    expect(parseDisplaying("Displaying 1 - 20 of 1,234")).toEqual({
      from: 1,
      to: 20,
      of: 1234,
    });
    expect(parseDisplaying("no counts here")).toBeNull();
  });

  it("collects per-event link titles in page order", () => {
    const titles = parseEventLinkTitles(
      [
        '<a href="/en/event/winter-concert">Winter <b>Concert</b></a>',
        '<a href="https://booking.example.test/en/event/spring-fair">Spring Fair</a>',
        '<a href="/en/node/1/opl_new_add_to_calendar.ics">Add to calendar</a>',
        '<a href="/en/program">Back to listing</a>',
      ].join("\n"),
    );
    expect(titles).toEqual(["Winter Concert", "Spring Fair"]);
  });

  it("parses the filter form with selects and options", () => {
    const form = parseFilterForm(
      [
        '<form method="get" action="/en/program">',
        '<select name="field_location">',
        '<option value="">- Any -</option>',
        '<option value="3">Nepean Centrepointe</option>',
        '<option value="7">Main &amp; Branch</option>',
        "</select>",
        '<select name="field_audience">',
        '<option value="All">- Any -</option>',
        '<option value="adult">Adult</option>',
        "</select>",
        "</form>",
      ].join("\n"),
    );
    expect(form?.method).toBe("get");
    expect(form?.action).toBe("/en/program");
    expect(form?.selects.map((s) => s.name)).toEqual([
      "field_location",
      "field_audience",
    ]);
    expect(form?.selects[0].options[2]).toEqual({
      value: "7",
      label: "Main & Branch",
    });
  });

  it("returns null when no form carries a select", () => {
    expect(parseFilterForm("<form><input></form>")).toBeNull();
    expect(parseFilterForm("<p>no form</p>")).toBeNull();
  });

  it("filters selects down to real options", () => {
    expect(
      realOptions({
        name: "field_age_group_target_id",
        options: [
          { value: "All", label: "- Any -" },
          { value: "", label: "Empty" },
          { value: "1147", label: "Adult" },
          { value: "1148", label: "Teen" },
        ],
      }),
    ).toEqual([
      { value: "1147", label: "Adult" },
      { value: "1148", label: "Teen" },
    ]);
  });

  it("picks branch/audience options first and skips any-options", () => {
    const picks = pickFilterCandidates(
      {
        method: "get",
        action: "",
        selects: [
          {
            name: "field_subject",
            options: [
              { value: "", label: "- Any -" },
              { value: "9", label: "Music and Dance" },
            ],
          },
          {
            name: "field_location",
            options: [
              { value: "", label: "- Any -" },
              { value: "3", label: "Nepean Centrepointe" },
            ],
          },
          {
            name: "field_audience",
            options: [
              { value: "All", label: "- Any -" },
              { value: "teen", label: "Teen" },
            ],
          },
        ],
      },
      4,
    );
    expect(picks).toEqual([
      { select: "field_location", value: "3", label: "Nepean Centrepointe" },
      { select: "field_audience", value: "teen", label: "Teen" },
      { select: "field_subject", value: "9", label: "Music and Dance" },
    ]);
  });
});
