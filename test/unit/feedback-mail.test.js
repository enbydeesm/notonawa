import { describe, it, expect, vi } from "vitest";
import { feedbackEmail } from "../../src/feedback/mail.js";
import { notifyFeedback } from "../../src/feedback/notify.js";

const AT = "2026-10-20T18:02:11Z";

describe("feedbackEmail", () => {
  it("says a bug report for a bug, and feedback for an idea", () => {
    expect(feedbackEmail({ kind: "bug", app_version: "2026.10.20.001" }, AT)).toEqual({
      subject: "nōtonawa: new bug report",
      text: "A bug report was sent from version 2026.10.20.001 at 2026-10-20T18:02:11Z.\n\nRead it with: node scripts/feedback.mjs --remote\n",
    });
    expect(feedbackEmail({ kind: "idea", app_version: "2026.10.20.001" }, AT)).toEqual({
      subject: "nōtonawa: new feedback",
      text: "Feedback was sent from version 2026.10.20.001 at 2026-10-20T18:02:11Z.\n\nRead it with: node scripts/feedback.mjs --remote\n",
    });
  });

  it("never holds what was written", () => {
    const mail = feedbackEmail(/** @type {any} */ ({ kind: "bug", app_version: "2026.10.20.001", message: "SECRET" }), AT);
    expect(JSON.stringify(mail)).not.toContain("SECRET");
  });
});

describe("notifyFeedback", () => {
  const feedback = { kind: "bug", app_version: "2026.10.20.001" };

  it("sends it from and to our address", async () => {
    const send = vi.fn(async () => ({ messageId: "x" }));
    expect(await notifyFeedback(/** @type {any} */ ({ send }), feedback, AT)).toBe(true);
    expect(send).toHaveBeenCalledWith({
      from: "contact@notonawa.app", to: "contact@notonawa.app", ...feedbackEmail(feedback, AT),
    });
  });

  it("doesn't throw when sending fails, or send without the binding", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => { throw new Error("not verified"); });
    expect(await notifyFeedback(/** @type {any} */ ({ send }), feedback, AT)).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
    expect(await notifyFeedback(undefined, feedback, AT)).toBe(false);
  });
});
