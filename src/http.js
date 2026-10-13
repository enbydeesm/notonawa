// HTTP helpers shared by the API routes.

// Thrown for anything wrong with the request; becomes a 400 with this message.
export class BadInput extends Error {}

/**
 * @param {unknown} data
 * @param {number} [status]
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function notFound() {
  return json({ error: "Not found" }, 404);
}

export function noContent() {
  return new Response(null, { status: 204 });
}

/**
 * Reads the request body as a JSON object, or throws BadInput.
 * @param {Request} request
 * @returns {Promise<Record<string, any>>}
 */
export async function readJson(request) {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body;
  } catch {
    // fall through
  }
  throw new BadInput("Expected a JSON object.");
}
