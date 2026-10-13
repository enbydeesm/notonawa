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
