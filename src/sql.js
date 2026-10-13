// SQL snippets shared by the database modules.

// SQL for "now" as an ISO timestamp, e.g. '2026-10-11T21:51:00Z'.
// Every timestamp the app writes uses this format.
export const NOW = "strftime('%Y-%m-%dT%H:%M:%SZ', 'now')";
