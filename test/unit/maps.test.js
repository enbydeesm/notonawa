import { describe, it, expect } from "vitest";
import { coordsFromMapsUrl, isMapsLink, isShortLink } from "../../src/locations/maps.js";
import { resolveMapsLink } from "../../src/locations/resolve.js";

const PLACE = "https://www.google.com/maps/place/Big+Ben/@51.5007292,-0.1272003,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d51.5007325!4d-0.1246254!16s%2Fm%2F0c8p6";

/** @param {string} link */
const coords = (link) => coordsFromMapsUrl(new URL(link));

describe("isMapsLink", () => {
  it("accepts Google Maps links, full and short", () => {
    for (const link of [
      PLACE, "https://maps.app.goo.gl/abc123", "https://goo.gl/maps/abc", "https://maps.google.com/?q=1,2",
      "https://www.google.co.uk/maps/@51.5,-0.12,15z", "https://google.com.au/maps", "https://consent.google.com/m?continue=x",
    ]) expect(isMapsLink(new URL(link)), link).toBe(true);
  });

  it("rejects anything else", () => {
    for (const link of [
      "https://example.com/maps/@51.5,-0.12", "https://www.google.com/search?q=1,2", "https://goo.gl/abc",
      "https://google.com.evil.example/maps", "https://maps.app.goo.gl.evil.example/abc", "ftp://maps.google.com/",
    ]) expect(isMapsLink(new URL(link)), link).toBe(false);
  });

  it("only treats https short links as short links", () => {
    expect(isShortLink(new URL("https://maps.app.goo.gl/abc"))).toBe(true);
    expect(isShortLink(new URL("http://maps.app.goo.gl/abc"))).toBe(false);
  });
});

describe("coordsFromMapsUrl", () => {
  it("prefers the place's pin to where the map is centred", () => {
    expect(coords(PLACE)).toEqual({ latitude: 51.5007325, longitude: -0.1246254 });
  });

  it("reads lat,lng queries", () => {
    expect(coords("https://www.google.com/maps?q=51.5,-0.12")).toEqual({ latitude: 51.5, longitude: -0.12 });
    expect(coords("https://maps.google.com/?q=loc:-33.85,151.2")).toEqual({ latitude: -33.85, longitude: 151.2 });
    expect(coords("https://www.google.com/maps/search/?api=1&query=40.7%2C-74")).toEqual({ latitude: 40.7, longitude: -74 });
    expect(coords("https://maps.google.com/maps?ll=10,20&z=4")).toEqual({ latitude: 10, longitude: 20 });
  });

  it("falls back to where the map is centred", () => {
    expect(coords("https://www.google.com/maps/@-12.5,130.8,14z")).toEqual({ latitude: -12.5, longitude: 130.8 });
  });

  it("is null when there are none, or they're out of range", () => {
    expect(coords("https://www.google.com/maps?q=Big+Ben")).toBeNull();
    expect(coords("https://www.google.com/maps/place/Big+Ben")).toBeNull();
    expect(coords("https://www.google.com/maps?q=95,10")).toBeNull();
  });
});

describe("resolveMapsLink", () => {
  /**
   * A stand-in for Google: each requested address redirects as listed.
   * @param {Record<string, string>} redirects
   */
  function fakeGoogle(redirects) {
    /** @type {string[]} */
    const asked = [];
    /** @type {typeof fetch} */
    const fetchFn = async (input) => {
      const href = String(input);
      asked.push(href);
      return href in redirects
        ? new Response(null, { status: 302, headers: { location: redirects[href] } })
        : new Response("page", { status: 200 });
    };
    return { asked, fetchFn };
  }

  it("follows a short link to the coordinates", async () => {
    const google = fakeGoogle({ "https://maps.app.goo.gl/abc": PLACE });
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/abc"), google.fetchFn))
      .toEqual({ latitude: 51.5007325, longitude: -0.1246254 });
    expect(google.asked).toEqual(["https://maps.app.goo.gl/abc"]);
  });

  it("reads a full link without fetching anything", async () => {
    const google = fakeGoogle({});
    expect(await resolveMapsLink(new URL(PLACE), google.fetchFn)).not.toBeNull();
    expect(google.asked).toEqual([]);
  });

  it("goes past Google's consent page without fetching it", async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(PLACE)}`;
    const google = fakeGoogle({ "https://maps.app.goo.gl/abc": consent });
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/abc"), google.fetchFn)).not.toBeNull();
    expect(google.asked).toEqual(["https://maps.app.goo.gl/abc"]);
  });

  it("never follows a redirect away from Google Maps", async () => {
    const google = fakeGoogle({ "https://maps.app.goo.gl/abc": "http://169.254.169.254/@1,2" });
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/abc"), google.fetchFn)).toBeNull();
    expect(google.asked).toHaveLength(1);
  });

  it("gives up after a few redirects", async () => {
    const google = fakeGoogle({ "https://maps.app.goo.gl/a": "https://maps.app.goo.gl/b", "https://maps.app.goo.gl/b": "https://maps.app.goo.gl/a" });
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/a"), google.fetchFn)).toBeNull();
    expect(google.asked).toHaveLength(6);
  });

  it("is null when the link doesn't redirect, or Google can't be reached", async () => {
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/x"), fakeGoogle({}).fetchFn)).toBeNull();
    const offline = /** @type {typeof fetch} */ (async () => { throw new TypeError("network"); });
    expect(await resolveMapsLink(new URL("https://maps.app.goo.gl/x"), offline)).toBeNull();
  });
});
