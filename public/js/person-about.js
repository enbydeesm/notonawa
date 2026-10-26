// A person's "About" in the People dialog. Pure, so it's easy to test;
// views/people.js shows it.
//
// On my own profile it's "About me": what a profile invite can share, kept
// apart from the private notes, which never are. On anyone else's card it's
// what they shared with me, and when: shown only when there is some, and
// not edited here (their next share with an About replaces it). See
// considerations.md, "Sharing between accounts".

import { formatDate } from "./format.js";

/**
 * How to show a person's About, or null to hide it.
 * @param {{ is_self?: unknown, about?: string | null, about_shared_on?: string | null } | null} person null when adding one
 * @param {string} [locale] for the date
 * @returns {{ label: string, hint: string, readOnly: boolean } | null}
 */
export function aboutField(person, locale) {
  if (person?.is_self) {
    return {
      label: "About me",
      hint: "What a profile invite may optionally share.",
      readOnly: false,
    };
  }
  if (!person?.about) return null;
  return {
    label: "About them",
    hint: person.about_shared_on ? `Shared by them on ${formatDate(person.about_shared_on, locale)}` : "Shared by them.",
    readOnly: true,
  };
}
