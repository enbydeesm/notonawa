// The analytics' charts, drawn as SVG: bars over time, a list of partners
// with bars, and pie charts with a legend. No chart library (see
// considerations.md). Colors come from the --chart-* variables in app.css
// through classes, as the page's CSP allows no style attributes. Each chart
// says what it shows in words too, for screen readers.

import { h } from "./dom.js";
import { percent } from "./stats.js";

/**
 * @typedef {import("./stats-period.js").Bucket} Bucket
 * @typedef {import("./stats.js").Slice} Slice
 */

const SVG = "http://www.w3.org/2000/svg";
/** How many colors the pie charts cycle through (--chart-1 to --chart-7). */
const COLORS = 7;

/**
 * @param {string} tag
 * @param {Record<string, string | number>} attrs
 * @param {...(Node | string)} children
 * @returns {SVGElement}
 */
function svg(tag, attrs, ...children) {
  const el = /** @type {SVGElement} */ (document.createElementNS(SVG, tag));
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  el.append(...children);
  return el;
}

/** @param {number} n */
const tiesWord = (n) => (n === 1 ? "1 tie" : `${n} ties`);

/**
 * Vertical bars, one per day, month or year, with the count over each bar
 * while there's room, and the labels underneath (every few, when there are
 * many bars).
 * @param {Bucket[]} bars
 * @param {string} description what the chart shows, e.g. "Ties each month"
 */
export function barChart(bars, description) {
  const width = 340, height = 150, top = 14, bottom = 18;
  const plot = height - top - bottom;
  const gap = bars.length > 20 ? 1.5 : 4;
  const barWidth = (width - gap * (bars.length - 1)) / Math.max(bars.length, 1);
  const max = Math.max(1, ...bars.map((b) => b.count));
  const every = bars.length <= 14 ? 1 : Math.ceil(bars.length / 7);
  const showCounts = bars.length <= 16;

  const chart = svg("svg", {
    viewBox: `0 0 ${width} ${height}`, class: "bar-chart", role: "img",
    "aria-label": `${description}: ${bars.filter((b) => b.count).map((b) => `${b.title} ${b.count}`).join(", ") || "none"}`,
  });
  bars.forEach((bar, i) => {
    const x = i * (barWidth + gap);
    const barHeight = bar.count ? Math.max(2, (bar.count / max) * plot) : 1.5;
    const y = top + plot - barHeight;
    const group = svg("g", { class: bar.count ? "bar" : "bar empty" },
      svg("title", {}, `${bar.title}: ${tiesWord(bar.count)}`),
      svg("rect", { x: x.toFixed(2), y: y.toFixed(2), width: barWidth.toFixed(2), height: barHeight.toFixed(2), rx: 2 }));
    if (showCounts && bar.count) {
      group.append(svg("text", { x: (x + barWidth / 2).toFixed(2), y: (y - 3).toFixed(2), class: "bar-value" }, String(bar.count)));
    }
    if (i % every === 0) {
      group.append(svg("text", { x: (x + barWidth / 2).toFixed(2), y: height - 4, class: "bar-label" }, bar.label));
    }
    chart.append(group);
  });
  return chart;
}

/**
 * Who I tied with most: each name with a bar as long as their count,
 * against the most.
 * @param {Slice[]} slices
 */
export function partnerBars(slices) {
  const max = Math.max(1, ...slices.map((s) => s.count));
  return h("ol", { className: "partner-bars" },
    slices.map((slice) => h("li", {},
      h("span", { className: "partner-bar" },
        svg("svg", { viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" },
          svg("rect", { x: 0, y: 0, width: ((slice.count / max) * 100).toFixed(2), height: 10, rx: 1.5 }))),
      h("span", { className: "partner-name" }, slice.label || "(no name)"),
      h("span", { className: "partner-count" }, String(slice.count), h("span", { className: "visually-hidden" }, slice.count === 1 ? " tie" : " ties")))));
}

/**
 * A pie chart with its legend: each slice's name, count and share.
 * @param {Slice[]} slices
 * @param {string} description what the chart shows, e.g. "Ties by type"
 */
export function pieChart(slices, description) {
  const total = slices.reduce((n, s) => n + s.count, 0);
  const pie = svg("svg", { viewBox: "-1 -1 2 2", class: "pie", "aria-hidden": "true", focusable: "false" });
  let angle = -Math.PI / 2; // from the top, clockwise
  slices.forEach((slice, i) => {
    const color = `slice chart-${(i % COLORS) + 1}`;
    if (slice.count === total) {
      pie.append(svg("circle", { cx: 0, cy: 0, r: 1, class: color }));
      return;
    }
    const sweep = (slice.count / total) * Math.PI * 2;
    const [x1, y1] = [Math.cos(angle), Math.sin(angle)];
    angle += sweep;
    const [x2, y2] = [Math.cos(angle), Math.sin(angle)];
    const large = sweep > Math.PI ? 1 : 0;
    pie.append(svg("path", {
      d: `M0 0L${x1.toFixed(4)} ${y1.toFixed(4)}A1 1 0 ${large} 1 ${x2.toFixed(4)} ${y2.toFixed(4)}Z`, class: color,
    }));
  });

  const legend = h("ul", { className: "pie-legend", "aria-label": description },
    slices.map((slice, i) => h("li", {},
      h("span", { className: `swatch chart-${(i % COLORS) + 1}`, "aria-hidden": "true" }),
      h("span", { className: "legend-name" }, slice.label),
      h("span", { className: "legend-count" }, `${slice.count} · ${percent(slice.count, total)}%`))));
  return h("div", { className: "pie-chart" }, pie, legend);
}
