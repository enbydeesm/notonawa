// Routes for bug reports and ideas sent from the app's menu.

import { json, readJson } from "../http.js";
import { parseFeedback } from "./parse.js";
import { addFeedback } from "./db.js";
import { notifyFeedback } from "./notify.js";

/** @typedef {import("../auth/user.js").User} User */

/**
 * Returns a Response if the request is for one of these routes, otherwise null.
 * @param {Request} request
 * @param {Env} env
 * @param {User} user
 * @param {URL} url
 * @returns {Promise<Response | null>}
 */
export async function handleFeedback(request, env, user, url) {
  // POST /api/feedback  body { kind, message, app_version } -> 201 {}: saves
  //   a bug report or idea for us to read (scripts/feedback.mjs), and
  //   emails us that it came (its kind and version, not what it says).
  //   429 after too many in a day.
  if (url.pathname === "/api/feedback" && request.method === "POST") {
    const feedback = parseFeedback(await readJson(request));
    const sentAt = await addFeedback(env.DB, user.id, feedback);
    if (!sentAt) {
      return json({ error: "That's a lot of messages for one day. Email us instead, or try again tomorrow." }, 429);
    }
    await notifyFeedback(env.FEEDBACK_EMAIL, feedback, sentAt);
    return json({}, 201);
  }
  return null;
}
