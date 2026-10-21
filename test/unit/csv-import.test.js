import { describe, it, expect } from "vitest";
import { parseCsv } from "../../public/js/csv.js";
import { csvToImport } from "../../public/js/import-csv.js";
import template from "../../public/import-template.csv?raw";
import { readExport, exportRoleNames, remapTies, remapWorkshops, checkLinks, batches, describeItems } from "../../public/js/import-steps.js";
import { setRoleNames } from "../../public/js/roles.js";

describe("parseCsv", () => {
  it("reads plain and quoted cells", () => {
    expect(parseCsv('a,b,c\n1,"two, with comma","say ""hi"""\n')).toEqual([
      ["a", "b", "c"], ["1", "two, with comma", 'say "hi"'],
    ]);
  });

  it("keeps line breaks inside quotes, and handles Windows line endings and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"line 1\r\nline 2",x\r\n')).toEqual([["a", "b"], ["line 1\r\nline 2", "x"]]);
  });

  it("reads the last row without a line break, and empty cells", () => {
    expect(parseCsv("a,b\n,\n1,")).toEqual([["a", "b"], ["", ""], ["1", ""]]);
  });

  it("uses semicolons or tabs when the first line has no commas", () => {
    expect(parseCsv('date;title;people\n2026-10-12;Floor;"Sam (model); Alex (rigger)"')).toEqual([
      ["date", "title", "people"], ["2026-10-12", "Floor", "Sam (model); Alex (rigger)"],
    ]);
    expect(parseCsv("date\ttitle\n2026-10-12\tFloor")).toEqual([["date", "title"], ["2026-10-12", "Floor"]]);
  });

  it("refuses a quote that's never closed", () => {
    expect(() => parseCsv('a,b\n"open,1')).toThrow("never closed");
  });
});

/**
 * The rows with a "type" column added (every tie needs one), floor on each.
 * @param {string[][]} rows
 */
const typed = (rows) => rows.map((row, i) => [...row, i === 0 ? "type" : "floor"]);

describe("csvToImport", () => {
  it("turns rows into ties, naming each person, location and plan once", () => {
    const { doc, errors } = csvToImport([
      ["Date", "Title", "Type", "Duration", "Rating", "Location", "People", "Plans", "Tags", "Notes", "Album"],
      ["2026-10-12", "Floor", "Floor", "45", "4", "Studio", "Sam (Model); Alex (rigger)", "TK; Hip harness", "floor; Practice", "Good",
        " https://photos.app.goo.gl/abc "],
      ["", "", "", "", "", "", "", "", "", "", ""],
      ["2026-10-13", "", "Partial  Suspension", "", "", "studio", "sam (rigger)", "tk", "", "", ""],
    ]);
    expect(errors).toEqual([]);
    expect(doc.people).toEqual([{ id: "person-1", name: "Sam" }, { id: "person-2", name: "Alex" }]);
    expect(doc.locations).toEqual([{ id: "location-1", name: "Studio" }]);
    expect(doc.plans).toEqual([{ id: "plan-1", title: "TK" }, { id: "plan-2", title: "Hip harness" }]);
    expect(doc.ties).toEqual([
      {
        title: "Floor", tie_date: "2026-10-12", tie_type: "floor", duration_minutes: 45, success_rating: 4, notes: "Good",
        album_url: "https://photos.app.goo.gl/abc", location_id: "location-1",
        participants: [{ person_id: "person-1", role: "bottom" }, { person_id: "person-2", role: "top" }],
        plans: [{ plan_id: "plan-1" }, { plan_id: "plan-2" }],
        tags: ["floor", "Practice"],
      },
      {
        title: null, tie_date: "2026-10-13", tie_type: "partial suspension", duration_minutes: null, success_rating: null, notes: null,
        album_url: null, location_id: "location-1", participants: [{ person_id: "person-1", role: "top" }],
        plans: [{ plan_id: "plan-1" }], tags: [],
      },
    ]);
  });

  it("accepts columns in any order, and no title", () => {
    const { doc, errors } = csvToImport([["notes", "type", "date"], ["n", "hashira", "2026-10-12"]]);
    expect(errors).toEqual([]);
    expect(doc.ties[0]).toMatchObject({ title: null, notes: "n", tie_date: "2026-10-12" });
  });

  it("names the spreadsheet row of each problem", () => {
    const { errors } = csvToImport([
      ["date", "title", "people", "rating", "duration", "type", "album"],
      ["12/10/2026", "x", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
      ["2026-10-12", "x", "Sam", "", "", "floor", ""],
      ["2026-10-12", "x", "Sam (boss)", "", "", "floor", ""],
      ["2026-10-12", "x", "", "6", "", "floor", ""],
      ["2026-02-30", "x", "", "", "1.5", "", ""],
      ["", "", "", "", "30", "", ""],
      ["2026-10-12", "x", "", "", "", "hanging", ""],
      ["", "Undated", "", "", "", "", ""],
      ["2026-10-12", "No type", "", "", "", "", ""],
      ["2026-10-12", "x", "", "", "", "floor", "javascript:alert(1)"],
    ]);
    expect(errors).toEqual([
      'Row 2: Write the date as year-month-day, like 2026-10-12 (not "12/10/2026").',
      'Row 4: Give Sam a role, like "Sam (bottom)".',
      'Row 5: "boss" isn\'t a role. Use one of: top, bottom, self tie, spotter, photographer.',
      "Row 6: The rating should be a whole number from 1 to 5.",
      'Row 7: Write the date as year-month-day, like 2026-10-12 (not "2026-02-30").',
      "Row 8: Add a date.",
      'Row 9: "hanging" isn\'t a type. Use one of: suspension, partial suspension, floor, hashira.',
      "Row 10: Add a date.",
      "Row 11: Add a type: suspension, partial suspension, floor, hashira.",
      "Row 12: The album link should be a web address, starting with https://",
    ]);
  });

  it("refuses unknown columns and files without headings or ties", () => {
    expect(csvToImport([["date", "titel", "type"], ["2026-10-12", "x", "floor"]]).errors)
      .toEqual(["Unknown column: titel. Use date, title, type, duration, rating, location, latitude, longitude, people, plans, tags, notes, album."]);
    expect(csvToImport([["2026-10-12", "Floor"]]).errors[0]).toMatch("needs the column names");
    expect(csvToImport([["title"], ["Floor"]]).errors).toEqual(["The first row needs the column names, with a date column."]);
    expect(csvToImport([["date", "title"]]).errors).toEqual(["There are no ties in the file."]);
  });

  it("reads my own role names, the roles' own, and rigger and model", () => {
    setRoleNames({ top_label: "Rope Top", bottom_label: "bunny" });
    try {
      const { doc, errors } = csvToImport(typed([
        ["date", "people"],
        ["2026-10-12", "Sam (rope  top); Alex (Bunny)"],
        ["2026-10-13", "Sam (top); Alex (bottom); Kit (self tie)"],
        ["2026-10-14", "Sam (rigger); Alex (model); Kit (Spotter)"],
        ["2026-10-15", "Sam"],
      ]));
      expect(doc.ties.map((t) => t.participants.map((p) => p.role))).toEqual([
        ["top", "bottom"], ["top", "bottom", "self tie"], ["top", "bottom", "spotter"],
      ]);
      expect(errors).toEqual(['Row 5: Give Sam a role, like "Sam (bunny)".']);
    } finally {
      setRoleNames(null);
    }
  });

  it("puts latitude and longitude on the row's location, once", () => {
    const { doc, errors } = csvToImport(typed([
      ["date", "location", "Lat", "Long"],
      ["2026-10-12", "Gas Works", "47.6456", "-122.3344"],
      ["2026-10-13", "gas works", "", ""],
      ["2026-10-14", "Studio", "", ""],
      ["2026-10-15", "studio", "41.9", "-87.6"],
      ["2026-10-16", "Gas Works", "47.6456", "-122.3344"],
    ]));
    expect(errors).toEqual([]);
    expect(doc.locations).toEqual([
      { id: "location-1", name: "Gas Works", latitude: 47.6456, longitude: -122.3344 },
      { id: "location-2", name: "Studio", latitude: 41.9, longitude: -87.6 },
    ]);
    expect(doc.ties.map((t) => t.location_id)).toEqual(["location-1", "location-1", "location-2", "location-2", "location-1"]);
  });

  it("accepts lng and lon, and leaves locations without coordinates as they were", () => {
    expect(csvToImport(typed([["date", "location", "latitude", "lng"], ["2026-10-12", "A", "1", "2"]])).doc.locations)
      .toEqual([{ id: "location-1", name: "A", latitude: 1, longitude: 2 }]);
    expect(csvToImport(typed([["date", "location", "latitude", "lon"], ["2026-10-12", "A", "", ""]])).doc.locations)
      .toEqual([{ id: "location-1", name: "A" }]);
  });

  it("names the row of each coordinate problem", () => {
    const { errors } = csvToImport(typed([
      ["date", "location", "latitude", "longitude"],
      ["2026-10-12", "A", "47.6", ""],
      ["2026-10-12", "A", "", "-122.3"],
      ["2026-10-12", "A", "north", "-122.3"],
      ["2026-10-12", "A", "91", "0"],
      ["2026-10-12", "A", "0", "-180.5"],
      ["2026-10-12", "", "47.6", "-122.3"],
      ["2026-10-12", "B", "1", "2"],
      ["2026-10-12", "b", "1", "3"],
    ]));
    expect(errors).toEqual([
      "Row 2: Give both a latitude and a longitude, or neither.",
      "Row 3: Give both a latitude and a longitude, or neither.",
      "Row 4: The latitude should be a number from -90 to 90, like 47.6062.",
      "Row 5: The latitude should be a number from -90 to 90, like 47.6062.",
      "Row 6: The longitude should be a number from -180 to 180, like -122.3321.",
      "Row 7: Add a location for the latitude and longitude.",
      "Row 9: B already has different coordinates on an earlier row.",
    ]);
  });

  it("reads the downloadable template", () => {
    const { doc, errors } = csvToImport(parseCsv(template));
    expect(errors).toEqual([]);
    expect(doc.locations[0]).toMatchObject({ latitude: 47.6062, longitude: -122.3321 });
  });

  it("stops listing problems after 20", () => {
    const rows = [["date"], ...Array.from({ length: 30 }, () => ["bad"])];
    const { errors } = csvToImport(rows);
    expect(errors).toHaveLength(21);
    expect(errors[20]).toBe("…and more.");
  });
});

describe("import steps", () => {
  it("reads the role names an export was made with", () => {
    expect(exportRoleNames({ account: { settings: { top_label: "rigger", bottom_label: null, theme: "dark" } } }))
      .toEqual({ top_label: "rigger", bottom_label: null });
    expect(exportRoleNames({ account: { settings: { top_label: null, bottom_label: " ", theme: "dark" } } })).toBeNull();
    expect(exportRoleNames({ account: {} })).toBeNull();
    expect(exportRoleNames(null)).toBeNull();
  });

  it("reads only NotoNawa exports of a version it knows", () => {
    expect(readExport({ format: "notonawa-export", version: 1, ties: [{ title: "x" }] }))
      .toEqual({ people: [], locations: [], plans: [], tags: [], ties: [{ title: "x" }], workshops: [] });
    expect(() => readExport({ hello: 1 })).toThrow("isn't a NotoNawa export");
    expect(() => readExport(null)).toThrow("isn't a NotoNawa export");
    expect(() => readExport({ format: "notonawa-export", version: 2 })).toThrow("newer version");
  });

  it("swaps the file's ids for the journal's, keeping deleted links", () => {
    const items = {
      people: [{ file_id: "p", name: "Sam", id: "P", matched: true }],
      locations: [{ file_id: "l", name: "Studio", id: "L", matched: false }],
      plans: [{ file_id: "x", name: "TK", id: "X", matched: false }],
      new_tags: [],
    };
    expect(remapTies([{
      title: "t", location_id: "l",
      participants: [{ person_id: "p", role: "bottom" }, { person_id: null, role: "spotter" }],
      plans: [{ plan_id: "x", plan_version: 2 }],
    }], items)).toEqual([{
      title: "t", location_id: "L",
      participants: [{ person_id: "P", role: "bottom" }, { person_id: null, role: "spotter" }],
      plans: [{ plan_id: "X", plan_version: 2 }],
    }]);
  });

  it("swaps a workshop's ids too, educators and participants alike", () => {
    const items = {
      people: [{ file_id: "p", name: "Sam", id: "P", matched: true }],
      locations: [{ file_id: "l", name: "Studio", id: "L", matched: false }],
      plans: [], new_tags: [],
    };
    expect(remapWorkshops([{
      title: "w", location_id: "l", educators: [{ person_id: "p", role: "top" }], participants: [{ person_id: null, role: "bottom" }],
    }], items)).toEqual([{
      title: "w", location_id: "L", educators: [{ person_id: "P", role: "top" }], participants: [{ person_id: null, role: "bottom" }],
    }]);
    const doc = readExport({ format: "notonawa-export", version: 1, workshops: [{ title: "Intro", educators: [{ person_id: "x", role: "top" }] }] });
    expect(() => checkLinks(doc)).toThrow('Workshop 1 ("Intro") links to a person that isn\'t in the file.');
  });

  it("names a tie that links to something not in the file", () => {
    const doc = readExport({ format: "notonawa-export", version: 1, people: [{ id: "p", name: "Sam" }],
      ties: [{ title: "ok", participants: [{ person_id: "p", role: "bottom" }] }, { title: "Floor", location_id: "nowhere" }] });
    expect(() => checkLinks(doc)).toThrow('Tie 2 ("Floor") links to a location that isn\'t in the file.');
  });

  it("splits ties into batches", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([])).toEqual([]);
  });

  it("describes what's new and what's already there", () => {
    expect(describeItems([
      { file_id: "a", name: "Sam", id: "1", matched: true },
      { file_id: "b", name: "Alex", id: null, matched: false },
      { file_id: "c", name: "Jo", id: null, matched: false },
    ])).toEqual({ added: "2 new: Alex, Jo", matched: "1 already in your journal: Sam" });
    expect(describeItems([])).toEqual({ added: null, matched: null });
  });
});
