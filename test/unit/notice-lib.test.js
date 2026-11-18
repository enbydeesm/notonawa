import { describe, it, expect } from "vitest";
import { readNoticeArgs, sqlText, startOfDay } from "../../scripts/notice-lib.mjs";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

describe("readNoticeArgs", () => {
  it("reads a message for everyone, from now on", () => {
    expect(readNoticeArgs(["Back up and running", "--remote"])).toEqual({
      action: "add",
      notice: { message: "Back up and running", level: "info", link: null, userId: null, startsAt: null, endsAt: null, push: false },
    });
  });

  it("reads the options", () => {
    const todo = readNoticeArgs(["Hi", "--warning", "--user", ID, "--link", "privacy", "--from", "2026-11-01", "--until", "2026-11-30", "--push"]);
    expect(todo).toEqual({
      action: "add",
      notice: {
        message: "Hi", level: "warning", link: "privacy", userId: ID,
        startsAt: startOfDay("2026-11-01"), endsAt: startOfDay("2026-12-01"), push: true,
      },
    });
  });

  it("lists and ends", () => {
    expect(readNoticeArgs(["--list", "--remote"])).toEqual({ action: "list" });
    expect(readNoticeArgs(["--end", ID])).toEqual({ action: "end", id: ID });
  });

  it("refuses what it can't use", () => {
    expect(() => readNoticeArgs([])).toThrow("one argument");
    expect(() => readNoticeArgs(["a", "b"])).toThrow("one argument");
    expect(() => readNoticeArgs(["x".repeat(1001)])).toThrow("1 to 1000");
    expect(() => readNoticeArgs(["Hi", "--user", "me"])).toThrow("account's id");
    expect(() => readNoticeArgs(["Hi", "--link", "https://evil.example"])).toThrow("privacy");
    expect(() => readNoticeArgs(["Hi", "--until", "next week"])).toThrow("2026-11-01");
    expect(() => readNoticeArgs(["Hi", "--from", "2026-11-02", "--until", "2026-11-01"])).toThrow("after it starts");
    expect(() => readNoticeArgs(["--end", "1; DROP TABLE users"])).toThrow("id");
  });
});

describe("sqlText", () => {
  it("doubles quotes, so a message can't end the text early", () => {
    expect(sqlText("It's back')")).toBe("'It''s back'')'");
  });
});
