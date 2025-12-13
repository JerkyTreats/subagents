const LOG_LEVELS = ["error", "warn", "info", "debug"];
const LEVEL_TO_RANK = new Map(LOG_LEVELS.map((level, index) => [level, index]));

export function createLogger({ level = "info", stream = process.stderr } = {}) {
  const resolved = LEVEL_TO_RANK.has(level) ? level : "info";
  const minRank = LEVEL_TO_RANK.get(resolved);

  function write(kind, message, meta) {
    const ts = new Date().toISOString();
    const payload = meta ? ` ${safeJson(meta)}` : "";
    stream.write(`[${ts}] ${kind.toUpperCase()} ${message}${payload}\n`);
  }

  return {
    level: resolved,
    error(message, meta) {
      if (LEVEL_TO_RANK.get("error") <= minRank) write("error", message, meta);
    },
    warn(message, meta) {
      if (LEVEL_TO_RANK.get("warn") <= minRank) write("warn", message, meta);
    },
    info(message, meta) {
      if (LEVEL_TO_RANK.get("info") <= minRank) write("info", message, meta);
    },
    debug(message, meta) {
      if (LEVEL_TO_RANK.get("debug") <= minRank) write("debug", message, meta);
    },
  };
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "\"<unserializable>\"";
  }
}

