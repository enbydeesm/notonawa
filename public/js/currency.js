// A workshop's cost: an amount and its currency, sealed together as one
// encrypted field (workshops.cost), e.g. "USD 180.00". Pure, so it's easy
// to test. Amounts are added up per currency, never converted.

/**
 * The currencies offered, in the order the form lists them: US dollars
 * first, then the next most common. decimals: digits after the point
 * (none for yen).
 * @typedef {{ code: string, name: string, decimals: number }} Currency
 * @type {readonly Currency[]}
 */
export const CURRENCIES = Object.freeze([
  { code: "USD", name: "US dollar", decimals: 2 },
  { code: "CAD", name: "Canadian dollar", decimals: 2 },
  { code: "EUR", name: "Euro", decimals: 2 },
  { code: "GBP", name: "British pound", decimals: 2 },
  { code: "AUD", name: "Australian dollar", decimals: 2 },
  { code: "JPY", name: "Japanese yen", decimals: 0 },
  { code: "NZD", name: "New Zealand dollar", decimals: 2 },
  { code: "CHF", name: "Swiss franc", decimals: 2 },
  { code: "MXN", name: "Mexican peso", decimals: 2 },
]);

/** The currency a new workshop starts on when none has been used. */
export const DEFAULT_CURRENCY = "USD";

const MAX_AMOUNT = 10_000_000;

/** @param {string} code @returns {Currency | undefined} */
function currency(code) {
  return CURRENCIES.find((c) => c.code === code);
}

/**
 * A cost as the form sends it, sealed: "USD 180.00". Empty amount: null
 * (no cost). Throws, with words for the form, if the amount isn't one.
 * @param {string} code
 * @param {string} typed the amount as typed, e.g. "180", "1,250.5"
 * @returns {string | null}
 */
export function costText(code, typed) {
  const c = currency(code);
  if (!c) throw new Error("Choose a currency.");
  const text = typed.trim().replace(/,/g, "");
  if (text === "") return null;
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error("The cost should be a number, like 120 or 85.50.");
  const amount = Number(text);
  if (amount > MAX_AMOUNT) throw new Error("That cost is too large.");
  return `${c.code} ${amount.toFixed(c.decimals)}`;
}

/**
 * A sealed cost, opened: its currency and amount in the currency's
 * smallest unit (cents; yen), so totals add up exactly. Anything that
 * isn't one (unreadable, or from a newer version): null.
 * @param {string | null | undefined} text
 * @returns {{ currency: string, minor: number, amount: string } | null}
 */
export function readCost(text) {
  if (typeof text !== "string") return null;
  const match = /^([A-Z]{3}) (\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return null;
  const c = currency(match[1]);
  if (!c) return null;
  const minor = Math.round(Number(match[2]) * 10 ** c.decimals);
  return { currency: c.code, minor, amount: (minor / 10 ** c.decimals).toFixed(c.decimals) };
}

/**
 * An amount in a currency's smallest unit, shown with its symbol, e.g.
 * "$1,240" (no cents when there are none) or "€85.50".
 * @param {number} minor
 * @param {string} code
 * @returns {string}
 */
export function formatMoney(minor, code) {
  const decimals = currency(code)?.decimals ?? 2;
  const amount = minor / 10 ** decimals;
  const whole = Number.isInteger(amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: code, currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : decimals, maximumFractionDigits: decimals,
  }).format(amount);
}

/**
 * The currency a new workshop's cost starts on: the one on the workshop
 * added most recently with a cost, or USD.
 * @param {{ cost?: string | null, created_at?: string }[]} workshops opened
 * @returns {string}
 */
export function lastCurrency(workshops) {
  /** @type {string | null} */
  let latest = null;
  let when = "";
  for (const w of workshops) {
    const cost = readCost(w.cost);
    if (cost && (w.created_at ?? "") >= when) {
      latest = cost.currency;
      when = w.created_at ?? "";
    }
  }
  return latest ?? DEFAULT_CURRENCY;
}

/**
 * Costs added up per currency, the most used first (on the most
 * workshops; a tie goes to the larger total, then the list's order).
 * @param {(string | null | undefined)[]} costs sealed costs, opened
 * @returns {{ currency: string, minor: number, count: number }[]}
 */
export function totalsByCurrency(costs) {
  /** @type {Map<string, { currency: string, minor: number, count: number }>} */
  const totals = new Map();
  for (const text of costs) {
    const cost = readCost(text);
    if (!cost) continue;
    const t = totals.get(cost.currency) ?? { currency: cost.currency, minor: 0, count: 0 };
    t.minor += cost.minor;
    t.count++;
    totals.set(cost.currency, t);
  }
  const order = (/** @type {string} */ code) => CURRENCIES.findIndex((c) => c.code === code);
  return [...totals.values()].sort((a, b) => b.count - a.count || b.minor - a.minor || order(a.currency) - order(b.currency));
}
