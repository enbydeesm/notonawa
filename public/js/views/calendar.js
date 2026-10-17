// Calendar view: one month (this one to start), with the month's numbers
// above it and a rope hank on each day with a tie (the count on it when
// there's more than one). Tapping a day opens its tie, or lists its ties.
// The ties come from POST /api/stats/ties; stats.js does the counting.

import { api, errorMessage } from "../api.js";
import { h, $ } from "../dom.js";
import { today as todayIn } from "../format.js";
import { hankIcon } from "../rope-rating.js";
import { stat } from "../charts.js";
import { openTieList, openOneTie } from "../tie-list-dialog.js";
import { summarize, tiesByDay, percent, tieListHeading } from "../stats.js";
import { initialPeriod, stepPeriod, monthGrid, monthRange, monthTitle } from "../stats-period.js";

/** @typedef {import("../stats.js").StatsTie} StatsTie */

const WEEKDAY_HEADINGS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * @param {HTMLElement} _root the view's element
 * @param {{ signal: AbortSignal }} _context
 */
export function mount(_root, _context) {
  const today = todayIn();
  let month = today;
  // Only the newest answer is shown, if the arrows are tapped quickly.
  let latestRequest = 0;

  /** @param {-1 | 1} direction */
  const step = (direction) => () => { month = stepPeriod({ ...initialPeriod(month), period: "month" }, direction).anchor; load(); };
  $("#cal-prev").addEventListener("click", step(-1));
  $("#cal-next").addEventListener("click", step(1));

  async function load() {
    const id = ++latestRequest;
    const [y, m] = month.split("-").map(Number);
    $("#cal-title").textContent = monthTitle(y, m);
    const message = $("#cal-message");
    message.textContent = "";
    /** @type {StatsTie[]} */
    let ties;
    try {
      ties = (await api("/api/stats/ties", { method: "POST", body: monthRange(month) })).ties;
    } catch (err) {
      if (id === latestRequest) message.textContent = "Couldn't load this month: " + errorMessage(err);
      return;
    }
    if (id !== latestRequest) return;
    const s = summarize(ties);
    $("#cal-stats").replaceChildren(
      stat("Ties", String(s.ties)),
      stat("Partners", String(s.partners)),
      stat("Locations", String(s.locations)),
      stat("As top / rigger", String(s.asTop), `${percent(s.asTop, s.ties)}%`),
      stat("As bottom / model", String(s.asBottom), `${percent(s.asBottom, s.ties)}%`));
    drawMonth(y, m, tiesByDay(ties));
  }

  /**
   * The month as a grid of days, weeks starting on Sunday. A day with ties
   * is a button: one tie opens it in the tie form, several list them.
   * @param {number} y
   * @param {number} m
   * @param {Map<string, string[]>} days
   */
  function drawMonth(y, m, days) {
    const { lead, days: count } = monthGrid(y, m);
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h("li", { className: "cal-blank", "aria-hidden": "true" }));
    for (let d = 1; d <= count; d++) {
      const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const tieIds = days.get(date) ?? [];
      const when = new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
      const number = h("span", { className: "cal-num", "aria-hidden": "true" }, String(d));
      const className = ["cal-day", tieIds.length ? "has-ties" : "", date === today ? "today" : ""].filter(Boolean).join(" ");
      const current = date === today ? "date" : null;
      if (!tieIds.length) {
        cells.push(h("li", { className, "aria-label": when, "aria-current": current }, number));
        continue;
      }
      const icon = hankIcon();
      icon.classList.add("filled");
      cells.push(h("li", { className },
        h("button", {
          type: "button", className: "cal-day-button", "aria-current": current,
          "aria-label": `${when}: ${tieIds.length === 1 ? "1 tie" : `${tieIds.length} ties`}`,
          onclick: () => tieIds.length === 1
            ? openOneTie(tieIds[0], load, (text) => { $("#cal-message").textContent = text; })
            : openTieList({ heading: tieListHeading(when, tieIds.length), tieIds, onChange: load }),
        },
        number,
        h("span", { className: "cal-mark", "aria-hidden": "true" }, icon,
          tieIds.length > 1 ? h("span", { className: "cal-count" }, String(tieIds.length)) : null))));
    }
    $("#calendar").replaceChildren(
      h("ol", { className: "cal-weekdays", "aria-hidden": "true" }, WEEKDAY_HEADINGS.map((d) => h("li", {}, d))),
      h("ol", { className: "cal-days" }, cells));
  }

  load();
}
