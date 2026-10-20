/**
 * Server-side debug logs for AI routes and Gemini calls. Off unless DEBUG_AI=1, since they print
 * prompts, chat text and whole trips. DEBUG_AI_MAX_CHARS caps each entry (default 20000, 0 = no cap).
 */
export const debugEnabled = () => process.env.DEBUG_AI === "1" || process.env.DEBUG_AI === "true";

export function debugLog(scope: string, label: string, data?: unknown) {
  if (!debugEnabled()) return;
  let body = data === undefined ? "" : typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const max = Number(process.env.DEBUG_AI_MAX_CHARS ?? 20000);
  if (max > 0 && body.length > max) body = `${body.slice(0, max)}\n… (${body.length - max} more chars)`;
  console.log(`[debug:${scope}] ${label}${body ? `\n${body}` : ""}`);
}

/** Short id that ties together the logs of one request. */
export const debugId = () => Math.random().toString(36).slice(2, 7);
