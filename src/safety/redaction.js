// Heuristic token matcher: long, base64-ish, and either:
// - contains "=" (common base64 padding), OR
// - contains "_" and at least one digit (common API key shape).
// This avoids redacting many long snake_case identifiers (including filenames) that are letters+underscores only.
const TOKEN_RE =
  /(?<![A-Za-z0-9_=-])(?=[A-Za-z0-9_=-]{24,})(?:(?=[A-Za-z0-9_=-]*=)|(?=[A-Za-z0-9_=-]*_)(?=[A-Za-z0-9_=-]*\d))[A-Za-z0-9_=-]{24,}(?![A-Za-z0-9_=-])/g;
const GITHUB_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g;
const JWT_RE = /\beyJ[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\.[A-Za-z0-9_=-]{10,}\b/g;
const URL_CREDENTIALS_RE = /\b(https?:\/\/)([^\/\s:@]+):([^\/\s@]+)@/gi;

export function redactText(text) {
  if (typeof text !== "string" || text.length === 0) return text;

  let out = text;
  out = out.replace(URL_CREDENTIALS_RE, (_m, scheme) => `${scheme}[REDACTED]@`);
  out = out.replace(GITHUB_TOKEN_RE, "[REDACTED]");
  out = out.replace(JWT_RE, "[REDACTED]");
  out = out.replace(TOKEN_RE, "[REDACTED]");
  return out;
}

export function redactJson(value) {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactJson(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactJson(v);
    return out;
  }
  return value;
}
