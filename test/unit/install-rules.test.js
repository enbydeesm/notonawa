// Offering to install the app (public/js/install-rules.js). No DOM needed.
import { describe, it, expect } from "vitest";
import { platformOf, isDismissed, installOffer, PROMPT_TEXT, STEPS } from "../../public/js/install-rules.js";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.0.0 Mobile/15E148 Safari/604.1",
  // iPadOS asks for desktop sites, so it looks like a Mac.
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  macSafari16: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  macEdge: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  macFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:141.0) Gecko/20100101 Firefox/141.0",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:141.0) Gecko/141.0 Firefox/141.0",
  androidChrome: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  windowsChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
};

describe("platformOf", () => {
  it("finds iPhones and iPads, whatever the browser", () => {
    expect(platformOf(UA.iphoneSafari, 5)).toBe("ios");
    expect(platformOf(UA.iphoneChrome, 5)).toBe("ios");
    expect(platformOf(UA.ipad, 5)).toBe("ios");
  });
  it("finds Safari 17 and later on a Mac, without touch", () => {
    expect(platformOf(UA.macSafari, 0)).toBe("mac-safari");
    expect(platformOf(UA.macSafari16, 0)).toBe("other");
  });
  it("finds Firefox on Android", () => {
    expect(platformOf(UA.androidFirefox, 5)).toBe("android-firefox");
  });
  it("leaves the rest to the browser's own install window, or nothing", () => {
    for (const ua of [UA.macChrome, UA.macEdge, UA.macFirefox, UA.androidChrome, UA.windowsChrome, ""]) {
      expect(platformOf(ua, 0)).toBe("other");
    }
  });
});

describe("isDismissed", () => {
  it("is only what Not now stores", () => {
    expect(isDismissed("1")).toBe(true);
    for (const value of [null, undefined, "", "0", "true", 1]) expect(isDismissed(value)).toBe(false);
  });
});

describe("installOffer", () => {
  const base = { installed: false, dismissed: false, canPrompt: false, platform: /** @type {const} */ ("other") };

  it("offers the browser's install window when it's ready", () => {
    expect(installOffer({ ...base, canPrompt: true })).toEqual({ kind: "button", text: PROMPT_TEXT });
    expect(installOffer({ ...base, canPrompt: true, platform: "ios" })?.kind).toBe("button");
  });
  it("says where to find installing in Safari and Firefox", () => {
    expect(installOffer({ ...base, platform: "ios" })).toEqual({ kind: "steps", text: STEPS.ios });
    expect(installOffer({ ...base, platform: "mac-safari" })?.text).toContain("Add to Dock");
    expect(installOffer({ ...base, platform: "android-firefox" })?.kind).toBe("steps");
  });
  it("offers nothing where there's nothing to say", () => {
    expect(installOffer(base)).toBeNull();
  });
  it("offers nothing once installed, or after Not now", () => {
    expect(installOffer({ ...base, canPrompt: true, installed: true })).toBeNull();
    expect(installOffer({ ...base, platform: "ios", dismissed: true })).toBeNull();
  });
});
