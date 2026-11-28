// The + on the "Add a …" cards, the "Edit tags" dialog and the forms' small
// + buttons: a bold plus with round ends, in the button's text color. The
// button is the yellow square round it (app.css's .add-plus, .tag-add and
// .label-add). index.html's own + buttons have the same markup written out.

const SVG = "http://www.w3.org/2000/svg";

/** The plus, on a 32 × 32 grid: its arms 13.4 long and 3 thick. */
export const PLUS_PATH = "M16 9.3v13.4M9.3 16h13.4";

/** The + for a button. */
export function plusIcon() {
  const icon = document.createElementNS(SVG, "svg");
  for (const [attr, value] of Object.entries({ class: "plus-icon", viewBox: "0 0 32 32", "aria-hidden": "true" })) icon.setAttribute(attr, value);
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", PLUS_PATH);
  icon.append(path);
  return icon;
}
