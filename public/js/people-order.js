// The order people are shown in on a tie's or workshop's card. A tie and
// a workshop keep their people in the order they were entered (the form
// shows them so); on a card, "this is me" goes last, the rest as entered.
// Pure.

/**
 * People with "this is me" moved to the end, everyone else in the order given.
 * @template {{ is_self?: unknown }} P
 * @param {readonly P[]} people
 * @returns {P[]}
 */
export function selfLast(people) {
  return [...people.filter((p) => !p.is_self), ...people.filter((p) => p.is_self)];
}
