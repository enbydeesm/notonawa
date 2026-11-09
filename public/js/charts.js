// The analytics' charts, drawn as SVG: bars over time (or by weekday),
// partners and locations as rows of bars, and a pie chart with a legend. No
// chart library (see considerations.md). Colors come from the --chart-*
// variables in app.css through classes (c-yellow and so on), as the page's
// CSP allows no style attributes. Each chart says what it shows in words
// too, for screen readers.
//
// The role-colored charts (tie count, partners) split each bar by my role
// on the tie: top in yellow, bottom in purple, self tie in teal, or all grey
// when the role filter is spotter or photographer (stats.js, roleChartTies).

import { h } from "./dom.js";
import { percent } from "./stats.js";
import { roleName } from "./roles.js";
import { SEGMENT_COLORS, describeParts, tiesWord } from "./chart-parts.js";

export { TYPE_COLORS } from "./chart-parts.js";

/**
 * @typedef {import("./stats-period.js").Bucket} Bucket
 * @typedef {import("./stats.js").Slice} Slice
 * @typedef {import("./stats.js").Segment} Segment
 * @typedef {import("./chart-parts.js").Part} Part
 * @typedef {{ key: string, label: string, title: string, count: number, tieIds: string[], segments?: Part[] }} Bar
 */

const SVG = "http://www.w3.org/2000/svg";

/**
 * An SVG element (h() makes HTML ones). Also used by world-map.js.
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @param {...(Node | string)} children
 * @returns {SVGElement}
 */
export function svg(tag, attrs, ...children) {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG, tag));
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

/**
 * The key under a role-colored chart's heading: a swatch and name for each
 * part that can appear.
 * @param {Segment[]} keys
 */
export function roleKey(keys) {
  return h("ul", { className: "chart-key", "aria-hidden": "true" },
    keys.map((key) => h("li", {},
      h("span", { className: `swatch ${SEGMENT_COLORS[key]}` }),
      key === "other" ? "Ties" : `As ${roleName(key)}`)));
}

/**
 * Vertical bars, one per day, month, year or weekday, with the count over
 * each bar while there's room, and the labels underneath (every few, when
 * there are many bars). A bar with segments is stacked, first part at the
 * bottom; without, it's yellow.
 * Bars with ties are buttons (an invisible row over the chart, one per bar),
 * which call onPick. marks: a cap before the axis label of each bar with
 * a workshop (Analytics), the label's band a button that calls its onPick.
 * @template {Bar} B
 * @param {B[]} bars
 * @param {string} description what the chart shows, e.g. "Ties each month"
 * @param {(bar: B) => void} onPick
 * @param {({ label: string, onPick: () => void } | null)[]} [marks] one per bar
 */
export function barChart(bars, description, onPick, marks) {
  const width = 340, height = 150, top = 14, bottom = 18;
  const plot = height - top - bottom;
  const gap = bars.length > 20 ? 1.5 : 4;
  const barWidth = (width - gap * (bars.length - 1)) / Math.max(bars.length, 1);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const every = bars.length <= 14 ? 1 : Math.ceil(bars.length / 7);
  const showCounts = bars.length <= 16;

  // The picture is for the eye; screen readers get the buttons (and the
  // group's label).
  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "bar-chart", "aria-hidden": "true", focusable: "false" });
  bars.forEach((bar, i) => {
    const x = i * (barWidth + gap);
    const barHeight = bar.count ? Math.max(2, (bar.count / max) * plot) : 1.5;
    const y = top + plot - barHeight;
    const group = svg("g", { class: bar.count ? "bar" : "bar empty" }, svg("title", {}, `${bar.title}: ${describeParts(bar)}`));
    if (!bar.count) {
      group.append(svg("rect", { x: x.toFixed(2), y: y.toFixed(2), width: barWidth.toFixed(2), height: barHeight.toFixed(2), rx: 2 }));
    } else {
      // Stacked from the bottom up; the top part has the rounded corners
      // drawn over a square join (a clip would need an id per bar).
      const parts = bar.segments?.length ? bar.segments : [{ key: /** @type {Segment} */ ("top"), count: bar.count }];
      let base = top + plot;
      parts.forEach((part, n) => {
        const partHeight = (part.count / bar.count) * barHeight;
        base -= partHeight;
        const last = n === parts.length - 1;
        group.append(svg("rect", {
          x: x.toFixed(2), y: base.toFixed(2), width: barWidth.toFixed(2), height: (partHeight + (last ? 0 : 0.5)).toFixed(2),
          rx: last ? 2 : 0, class: SEGMENT_COLORS[part.key],
        }));
      });
    }
    if (showCounts && bar.count) {
      group.append(svg("text", { x: (x + barWidth / 2).toFixed(2), y: (y - 3).toFixed(2), class: "bar-value" }, String(bar.count)));
    }
    const marked = Boolean(marks?.[i]);
    const label = i % every === 0 ? bar.label : "";
    if (label || marked) {
      // The cap and the label centred together under the bar (the label's
      // width estimated: 9-unit text is about 5 units a character).
      const center = x + barWidth / 2;
      const textWidth = label.length * 5;
      const start = center - (marked ? (CAP_WIDTH + 1.5 + textWidth) / 2 : 0);
      if (marked) group.append(axisCap(start, height - 12));
      if (label) {
        group.append(svg("text", {
          x: (marked ? start + CAP_WIDTH + 1.5 + textWidth / 2 : center).toFixed(2), y: height - 4, class: "bar-label",
        }, label));
      }
    }
    chart.append(group);
  });
  // Each button covers its bar's share of the width, top to bottom, so even
  // a short bar is easy to tap.
  const hits = h("div", { className: "bar-hits" },
    bars.map((bar) => bar.count
      ? h("button", {
        type: "button", "aria-label": `${bar.title}: ${describeParts(bar)}`, title: `${bar.title}: ${describeParts(bar)}`,
        onclick: () => onPick(bar),
      })
      : h("span", { "aria-hidden": "true" })));
  // The marks' buttons cover the axis labels' band, under the bars' buttons.
  const markRow = marks?.some(Boolean)
    ? h("div", { className: "bar-marks" }, marks.map((mark) => (mark
      ? h("button", { type: "button", className: "bar-mark", "aria-label": mark.label, title: mark.label, onclick: mark.onPick })
      : h("span", { "aria-hidden": "true" }))))
    : null;
  return h("div", { className: "bar-chart-wrap", role: "group", "aria-label": description }, chart, hits, markRow);
}

/** How wide the axis's cap is, in the chart's units. */
const CAP_WIDTH = 8.8;

/**
 * The Education cap on a bar chart's axis, before a label: 24-unit paths
 * scaled to the labels' size.
 * @param {number} x its left
 * @param {number} y its top
 */
function axisCap(x, y) {
  return svg("g", { class: "axis-cap", transform: `translate(${(x - 0.8).toFixed(2)} ${y}) scale(0.4)` },
    svg("path", { d: "M2 9l10-5 10 5-10 5z" }), svg("path", { d: "M6 11v5c3 2.2 9 2.2 12 0v-5" }));
}

/** The graduation cap (as Education's tab), small: a plan card's workshop. */
export function capMark() {
  return svg("svg", { viewBox: "0 0 24 24", class: "cap-mark", "aria-hidden": "true", focusable: "false" },
    svg("path", { d: "M2 9l10-5 10 5-10 5z" }), svg("path", { d: "M6 11v5c3 2.2 9 2.2 12 0v-5" }));
}

/**
 * Who I tied with most: each name with a bar as long as their count,
 * against the most, split by my role with them.
 * Each row is a button that calls onPick.
 * @param {(Slice & { segments?: Part[] })[]} slices
 * @param {(slice: Slice) => void} onPick
 */
export function partnerBars(slices, onPick) {
  const max = Math.max(1, ...slices.map((s) => s.count));
  return h("ol", { className: "partner-bars" },
    slices.map((slice) => {
      const bar = svg("svg", { viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
      const parts = slice.segments?.length ? slice.segments : [{ key: /** @type {Segment} */ ("top"), count: slice.count }];
      let x = 0;
      for (const part of parts) {
        const w = (part.count / max) * 100;
        bar.append(svg("rect", { x: x.toFixed(2), y: 0, width: w.toFixed(2), height: 10, class: SEGMENT_COLORS[part.key] }));
        x += w;
      }
      return h("li", {}, h("button", {
        type: "button", className: "partner-row", onclick: () => onPick(slice), "aria-label": `${slice.label || "(no name)"}: ${describeParts(slice)}`,
      },
      h("span", { className: "partner-bar" }, bar),
      h("span", { className: "partner-name" }, slice.label || "(no name)"),
      h("span", { className: "partner-count", "aria-hidden": "true" }, String(slice.count))));
    }));
}

/**
 * Horizontal bars, busiest first: each name on the left (right-aligned,
 * cut short with "…" if long), then a yellow bar as long as its count
 * against the most, with the count just after it. Used for locations.
 * Each row is a button that calls onPick.
 * @param {Slice[]} slices
 * @param {string} description what the chart shows, e.g. "Ties by location"
 * @param {(slice: Slice) => void} onPick
 */
export function rankBars(slices, description, onPick) {
  const max = Math.max(1, ...slices.map((s) => s.count));
  return h("ol", { className: "rank-bars", "aria-label": description },
    slices.map((slice) => h("li", {}, h("button", {
      type: "button", className: "rank-row", onclick: () => onPick(slice), "aria-label": `${slice.label}: ${tiesWord(slice.count)}`,
    },
    h("span", { className: "rank-name", title: slice.label }, slice.label),
    h("span", { className: "rank-track", "aria-hidden": "true" },
      // Width as an attribute (a share of the track, leaving room for the
      // count), as the CSP allows no style attributes.
      svg("svg", { width: `${Math.max(1, (slice.count / max) * 85).toFixed(1)}%`, height: 18, viewBox: "0 0 100 18", preserveAspectRatio: "none", class: "rank-bar", focusable: "false" },
        svg("rect", { x: 0, y: 0, width: 100, height: 18, rx: 3, class: "c-yellow" })),
      h("span", { className: "rank-count" }, String(slice.count)))))));
}

/**
 * A pie chart with its legend: each slice's name, count and share.
 * Each legend entry is a button that calls onPick; tapping a slice does the
 * same.
 * @param {Slice[]} slices
 * @param {string} description what the chart shows, e.g. "Ties by type"
 * @param {(slice: Slice) => void} onPick
 * @param {(slice: Slice) => string} colorOf each slice's color class
 */
export function pieChart(slices, description, onPick, colorOf) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  const pie = svg("svg", { viewBox: "-1 -1 2 2", class: "pie", "aria-hidden": "true", focusable: "false" });
  let angle = -Math.PI / 2; // from the top, clockwise
  slices.forEach((slice) => {
    const color = `slice ${colorOf(slice)}`;
    if (slice.count === total) {
      const whole = svg("circle", { cx: 0, cy: 0, r: 1, class: color });
      whole.addEventListener("click", () => onPick(slice));
      pie.append(whole);
      return;
    }
    const sweep = (slice.count / total) * Math.PI * 2;
    const [x1, y1] = [Math.cos(angle), Math.sin(angle)];
    angle += sweep;
    const [x2, y2] = [Math.cos(angle), Math.sin(angle)];
    const large = sweep > Math.PI ? 1 : 0;
    const path = svg("path", {
      d: `M0 0L${x1.toFixed(4)} ${y1.toFixed(4)}A1 1 0 ${large} 1 ${x2.toFixed(4)} ${y2.toFixed(4)}Z`, class: color,
    });
    // The legend's buttons do the same for keyboards and screen readers.
    path.addEventListener("click", () => onPick(slice));
    pie.append(path);
  });

  const legend = h("ul", { className: "pie-legend", "aria-label": description },
    slices.map((slice) => h("li", {}, h("button", { type: "button", className: "legend-row", onclick: () => onPick(slice) },
      h("span", { className: `swatch ${colorOf(slice)}`, "aria-hidden": "true" }),
      h("span", { className: "legend-name" }, slice.label),
      h("span", { className: "legend-count" }, `${slice.count} · ${percent(slice.count, total)}%`)))));
  return h("div", { className: "pie-chart" }, pie, legend);
}

/**
 * One of the numbers at the top of Calendar and Analytics: its name, then
 * the value (and e.g. a percentage after it). Goes in a <dl>.
 * @param {string} label
 * @param {string} value
 * @param {string} [extra]
 */
export function stat(label, value, extra) {
  return h("div", { className: "stat" },
    h("dt", {}, label),
    h("dd", {}, value, extra ? h("span", { className: "stat-extra" }, extra) : null));
}
