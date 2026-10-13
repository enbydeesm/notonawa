// Ties page: log a tie, and list them.

import { api, errorMessage } from "../api.js";
import { h, $, showMessage } from "../dom.js";
import { today, capitalise } from "../format.js";
import { renderNav } from "../nav.js";
import { tieMeta, participantLabel, planLabel } from "../ties-view.js";

renderNav("/");

const ROLES = ["rigger", "top", "model", "bottom", "spotter", "photographer"];
/** @type {HTMLFormElement} */
const form = $("#tie-form");
const list = $("#tie-list");
const message = $("#message");
/** @type {HTMLButtonElement} */
const saveButton = $("#save");
const participantRows = $("#participants");
const planRows = $("#plans");
/** @type {HTMLInputElement} */
const dateInput = $("#tie_date");
/** @type {HTMLButtonElement} */
const addParticipantButton = $("#add-participant");
/** @type {HTMLButtonElement} */
const addPlanButton = $("#add-plan");

// Active (non-archived) people and plans for the pickers.
/** @type {Record<string, any>[]} */
let people = [];
/** @type {Record<string, any>[]} */
let plans = [];

dateInput.value = today();

/** @param {HTMLElement} row */
function removeButton(row) {
  return h("button", { type: "button", "aria-label": "Remove", onclick: () => row.remove() }, "✕");
}

function addParticipantRow() {
  const row = h("div", { className: "picker-row" });
  row.append(
    h("select", { className: "person", "aria-label": "Person" },
      h("option", { value: "" }, "Choose person"),
      people.map((p) => h("option", { value: p.id }, p.is_self ? `${p.name} (you)` : p.name))),
    h("select", { className: "role", "aria-label": "Role" },
      h("option", { value: "" }, "Role"),
      ROLES.map((r) => h("option", { value: r }, capitalise(r)))),
    removeButton(row)
  );
  participantRows.append(row);
}

function addPlanRow() {
  const row = h("div", { className: "picker-row" });
  row.append(
    h("select", { className: "plan", "aria-label": "Plan" },
      h("option", { value: "" }, "Choose plan"),
      plans.map((p) => h("option", { value: p.id }, p.title))),
    removeButton(row)
  );
  planRows.append(row);
}

addParticipantButton.addEventListener("click", addParticipantRow);
addPlanButton.addEventListener("click", addPlanRow);

async function loadPickers() {
  try {
    const [loadedPeople, locations, loadedPlans] = await Promise.all([
      api("/api/people"), api("/api/locations"), api("/api/plans"),
    ]);
    people = loadedPeople;
    plans = loadedPlans;

    $("#location_id").replaceChildren(
      h("option", { value: "" }, "No location"),
      ...locations.map((/** @type {any} */ l) => h("option", { value: l.id }, l.name))
    );

    addParticipantButton.hidden = people.length === 0;
    $("#no-people").hidden = people.length > 0;
    addPlanButton.hidden = plans.length === 0;
    $("#no-plans").hidden = plans.length > 0;
  } catch (err) {
    showMessage(message, "Couldn't load people, locations and plans: " + errorMessage(err), true);
  }
}

/** @param {import("../ties-view.js").Label} label */
function renderLabel(label) {
  return label.deleted ? h("span", { className: "deleted" }, label.text) : label.text;
}

/** @param {any[]} parts */
function joinWithCommas(parts) {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [", ", part]));
}

/** @param {Record<string, any>} tie */
function renderTie(tie) {
  const meta = tieMeta(tie);
  const participants = tie.participants.map((/** @type {any} */ p) => {
    const { name, role } = participantLabel(p);
    return [renderLabel(name), ` (${role})`];
  });
  const plansUsed = tie.plans.map((/** @type {any} */ p) => renderLabel(planLabel(p)));

  return h("div", { className: "item" },
    h("div", { className: "item-title" }, tie.title || "Untitled tie"),
    h("div", { className: "item-meta" },
      meta.flatMap((part, i) => (i === 0 ? [renderLabel(part)] : [" · ", renderLabel(part)]))),
    participants.length ? h("div", { className: "item-meta" }, "With: ", joinWithCommas(participants)) : null,
    plansUsed.length ? h("div", { className: "item-meta" }, "Plans: ", joinWithCommas(plansUsed)) : null,
    tie.notes ? h("div", { className: "item-notes" }, tie.notes) : null
  );
}

async function loadTies() {
  try {
    const ties = await api("/api/ties");
    list.replaceChildren();
    if (ties.length === 0) {
      list.append(h("p", { className: "empty" }, "No ties yet. Log your first one above."));
      return;
    }
    for (const tie of ties) list.append(renderTie(tie));
  } catch (err) {
    list.replaceChildren(h("p", { className: "empty" }, "Couldn't load ties: " + errorMessage(err)));
  }
}

function collectTie() {
  /** @type {Record<string, any>} */
  const data = Object.fromEntries(new FormData(form));

  data.participants = [];
  for (const row of participantRows.children) {
    const personId = /** @type {HTMLSelectElement} */ ($(".person", row)).value;
    const role = /** @type {HTMLSelectElement} */ ($(".role", row)).value;
    if (!personId && !role) continue; // empty row
    if (!personId || !role) throw new Error("Choose a person and a role for each row, or remove it.");
    data.participants.push({ person_id: personId, role });
  }

  data.plan_ids = [...planRows.querySelectorAll("select")].map((s) => s.value).filter(Boolean);
  return data;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveButton.disabled = true;
  showMessage(message, "Saving…");
  try {
    await api("/api/ties", { method: "POST", body: collectTie() });
    form.reset();
    participantRows.replaceChildren();
    planRows.replaceChildren();
    dateInput.value = today();
    showMessage(message, "Saved.");
    loadTies();
  } catch (err) {
    showMessage(message, "Couldn't save: " + errorMessage(err), true);
  } finally {
    saveButton.disabled = false;
  }
});

loadPickers();
loadTies();
