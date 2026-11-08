import { describe, it, expect } from "vitest";
import {
  CURRENCIES, DEFAULT_CURRENCY, costText, readCost, formatMoney, lastCurrency, totalsByCurrency,
} from "../../public/js/currency.js";

describe("currencies", () => {
  it("lists US, Canadian, euro and pound first, USD the default", () => {
    expect(CURRENCIES.slice(0, 4).map((c) => c.code)).toEqual(["USD", "CAD", "EUR", "GBP"]);
    expect(CURRENCIES.map((c) => c.code)).toEqual(["USD", "CAD", "EUR", "GBP", "AUD", "JPY", "NZD", "CHF", "MXN"]);
    expect(DEFAULT_CURRENCY).toBe("USD");
  });
});

describe("costText", () => {
  it("writes the amount with its currency's decimals", () => {
    expect(costText("USD", "180")).toBe("USD 180.00");
    expect(costText("EUR", " 1,250.5 ")).toBe("EUR 1250.50");
    expect(costText("JPY", "12000")).toBe("JPY 12000");
    expect(costText("GBP", "0")).toBe("GBP 0.00");
  });

  it("is null with no amount, and refuses what isn't one", () => {
    expect(costText("USD", "  ")).toBeNull();
    for (const typed of ["abc", "-5", "1.2.3", "$10", "1e5"]) expect(() => costText("USD", typed), typed).toThrow();
    expect(() => costText("USD", "20000000")).toThrow(/too large/);
    expect(() => costText("XYZ", "10")).toThrow(/currency/);
  });
});

describe("readCost", () => {
  it("reads a sealed cost back, in the smallest unit", () => {
    expect(readCost("USD 180.00")).toEqual({ currency: "USD", minor: 18000, amount: "180.00" });
    expect(readCost("JPY 12000")).toEqual({ currency: "JPY", minor: 12000, amount: "12000" });
    expect(readCost(costText("CAD", "19.99"))).toEqual({ currency: "CAD", minor: 1999, amount: "19.99" });
  });

  it("is null for anything else", () => {
    for (const text of [null, undefined, "", "180", "usd 1.00", "XYZ 1.00", "USD -1"]) expect(readCost(text)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("shows the symbol, and cents only when there are some", () => {
    expect(formatMoney(124000, "USD")).toBe("$1,240");
    expect(formatMoney(8550, "EUR")).toBe("€85.50");
    expect(formatMoney(12000, "JPY")).toBe("¥12,000");
    expect(formatMoney(500, "GBP")).toBe("£5");
  });
});

describe("lastCurrency", () => {
  it("is the currency of the workshop added last with a cost, or USD", () => {
    expect(lastCurrency([])).toBe("USD");
    expect(lastCurrency([{ cost: null, created_at: "2026-05-01T00:00:00Z" }])).toBe("USD");
    expect(lastCurrency([
      { cost: "EUR 10.00", created_at: "2026-01-01T00:00:00Z" },
      { cost: "GBP 5.00", created_at: "2026-03-01T00:00:00Z" },
      { cost: null, created_at: "2026-06-01T00:00:00Z" },
      { cost: "CAD 1.00", created_at: "2026-02-01T00:00:00Z" },
    ])).toBe("GBP");
  });
});

describe("totalsByCurrency", () => {
  it("adds up each currency on its own, the most used first", () => {
    expect(totalsByCurrency(["USD 100.00", "EUR 300.00", "USD 40.50", null, "garbled", "GBP 85.00"])).toEqual([
      { currency: "USD", minor: 14050, count: 2 },
      { currency: "EUR", minor: 30000, count: 1 },
      { currency: "GBP", minor: 8500, count: 1 },
    ]);
  });

  it("breaks a tie by the larger total, then the list's order", () => {
    expect(totalsByCurrency(["GBP 5.00", "EUR 5.00", "CAD 9.00"]).map((t) => t.currency)).toEqual(["CAD", "EUR", "GBP"]);
    expect(totalsByCurrency([])).toEqual([]);
  });
});
