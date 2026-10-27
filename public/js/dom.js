// DOM helpers. Everything user-entered goes on the page as text (via h()),
// never innerHTML, so names and notes can't inject HTML.

/**
 * Builds an element: h("div", { className: "x", onclick: fn }, "text", child).
 * Children can be strings, numbers, nodes, or (nested) arrays of them;
 * null/undefined/false are skipped.
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key in el) /** @type {any} */ (el)[key] = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/**
 * Keeps what's typed in a field out of the browser's saved form history and
 * its spellcheck (some browsers send spellchecked text to their maker). Every
 * input and textarea gets this, except checkboxes; the HTML pages set the same
 * two attributes directly. Set as attributes because h() skips false values.
 * @template {HTMLInputElement | HTMLTextAreaElement} T
 * @param {T} field
 * @returns {T}
 */
export function privateField(field) {
  field.setAttribute("autocomplete", "off");
  field.setAttribute("spellcheck", "false");
  return field;
}

/**
 * Finds an element that must exist on the page. It's typed as HTMLElement
 * unless you annotate the result with a more specific type (e.g. an input).
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {T}
 */
export function $(selector, root = document) {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return /** @type {T} */ (el);
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @param {boolean} [isError]
 */
export function showMessage(el, text, isError = false) {
  el.textContent = text;
  el.className = isError ? "message error" : "message";
}

/**
 * Makes an "i" button show and hide the explanation it controls (the element
 * named by its aria-controls), keeping aria-expanded up to date.
 * @param {HTMLButtonElement} button
 */
export function infoButton(button) {
  toggles(button, $(`#${button.getAttribute("aria-controls")}`));
}

/**
 * A "?" button and the explanation it shows under its label, for a form
 * built in code. Tapping it shows or hides the explanation; with a mouse,
 * hovering shows it too, until the pointer leaves (unless it was clicked
 * open). Put the button beside the label and the explanation after it.
 * @param {string} id the explanation's id
 * @param {string} label what the button is about, for screen readers
 * @param {string} text
 * @returns {{ button: HTMLButtonElement, text: HTMLParagraphElement }}
 */
export function infoTip(id, label, text) {
  const note = h("p", { className: "info-text", id, hidden: true }, text);
  const button = h("button", {
    type: "button", className: "info-button", "aria-label": label, title: label,
    "aria-expanded": "false", "aria-controls": id,
  }, "?");
  toggles(button, note);
  let hovering = false;
  button.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse" || button.getAttribute("aria-expanded") === "true") return;
    hovering = true;
    note.hidden = false;
  });
  button.addEventListener("pointerleave", () => {
    if (!hovering) return;
    hovering = false;
    if (button.getAttribute("aria-expanded") !== "true") note.hidden = true;
  });
  // A click while hovering keeps it open (it's showing already).
  button.addEventListener("click", () => { hovering = false; }, { capture: true });
  return { button, text: note };
}

/**
 * Makes a button show and hide an element, keeping aria-expanded up to date.
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} text
 */
function toggles(button, text) {
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    text.hidden = !open;
  });
}

/**
 * The small × on a chosen value's top-right corner that takes it off, like
 * a tag's: on a picker row (a location, person, plan or alias), which needs
 * the class "removable".
 * @param {string} label what it removes, for screen readers and the tooltip
 * @param {() => void} onclick
 * @returns {HTMLButtonElement}
 */
export function removeX(label, onclick) {
  return h("button", { type: "button", className: "tag-x", "aria-label": label, title: label, onclick }, "×");
}

/**
 * Makes a card in a list open when it's tapped anywhere, not just its title
 * (which stays the button keyboards and screen readers use). A tap on a
 * link, button or field on the card does only its own thing, and so does
 * the tap that ends selecting some of its text.
 * @template {HTMLElement} T
 * @param {T} card
 * @param {() => void} open
 * @returns {T}
 */
export function opensOnTap(card, open) {
  card.classList.add("tappable");
  card.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("a, button, input, select, textarea, label")) return;
    if (getSelection()?.toString()) return;
    open();
  });
  return card;
}
