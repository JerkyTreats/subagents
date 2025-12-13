import fs from "node:fs";
import path from "node:path";

const DEFAULT_CONFIG = Object.freeze({
  roots: ["."],
  limits: {
    maxFilesRead: 50,
    maxBytesRead: 1024 * 1024,
  },
  runtime: {
    maxConcurrentTasks: 4,
    defaultDeadlineMs: 30_000,
  },
  provider: {
    kind: null,
  },
  logging: {
    level: "info",
  },
});

const VALID_LOG_LEVELS = new Set(["error", "warn", "info", "debug"]);

export function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  const configPath = resolveConfigPath({ cwd, env });
  const userConfig = configPath ? readJsonFile(configPath) : {};

  const merged = {
    ...DEFAULT_CONFIG,
    ...userConfig,
    limits: { ...DEFAULT_CONFIG.limits, ...(userConfig.limits ?? {}) },
    runtime: { ...DEFAULT_CONFIG.runtime, ...(userConfig.runtime ?? {}) },
    provider: { ...DEFAULT_CONFIG.provider, ...(userConfig.provider ?? {}) },
    logging: { ...DEFAULT_CONFIG.logging, ...(userConfig.logging ?? {}) },
  };

  const roots = normalizeRoots(merged.roots, cwd);
  const loggingLevel = String(merged.logging.level ?? "info");
  if (!VALID_LOG_LEVELS.has(loggingLevel)) {
    throw new Error(
      `Invalid logging.level "${loggingLevel}". Expected one of: ${Array.from(
        VALID_LOG_LEVELS,
      ).join(", ")}`,
    );
  }

  return {
    roots,
    limits: {
      maxFilesRead: coercePositiveInt(merged.limits.maxFilesRead, "limits.maxFilesRead"),
      maxBytesRead: coercePositiveInt(merged.limits.maxBytesRead, "limits.maxBytesRead"),
    },
    runtime: {
      maxConcurrentTasks: coercePositiveInt(
        merged.runtime.maxConcurrentTasks,
        "runtime.maxConcurrentTasks",
      ),
      defaultDeadlineMs: coercePositiveInt(
        merged.runtime.defaultDeadlineMs,
        "runtime.defaultDeadlineMs",
      ),
    },
    provider: normalizeProviderConfig(merged.provider, { env }),
    logging: {
      level: loggingLevel,
    },
    _meta: {
      configPath: configPath ?? null,
    },
  };
}

function resolveConfigPath({ cwd, env }) {
  const fromEnv = env.SUBAGENTS_CONFIG;
  if (fromEnv && String(fromEnv).trim().length > 0) return path.resolve(cwd, String(fromEnv));

  const defaultPath = path.resolve(cwd, "subagents.config.json");
  return fs.existsSync(defaultPath) ? defaultPath : null;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON config at ${filePath}: ${error.message}`);
  }
}

function normalizeRoots(roots, cwd) {
  if (!Array.isArray(roots)) throw new Error(`Invalid roots; expected array`);
  const resolved = roots
    .map((root) => {
      if (typeof root !== "string" || root.trim().length === 0) {
        throw new Error(`Invalid root "${String(root)}"; expected non-empty string`);
      }
      return path.resolve(cwd, root);
    })
    .map((root) => path.normalize(root));

  return Array.from(new Set(resolved)).sort();
}

function coercePositiveInt(value, label) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0 || !Number.isInteger(asNumber)) {
    throw new Error(`Invalid ${label}; expected positive integer`);
  }
  return asNumber;
}

function normalizeProviderConfig(provider, { env }) {
  if (provider == null || typeof provider !== "object" || Array.isArray(provider)) {
    throw new Error(`Invalid provider; expected object`);
  }

  const kind = provider.kind ?? null;
  if (kind == null || kind === "" || kind === false) return { kind: null };

  if (kind !== "lmstudio-openai") {
    throw new Error(`Invalid provider.kind "${String(kind)}"`);
  }

  const baseUrl = String(provider.baseUrl ?? env.SUBAGENTS_LMSTUDIO_BASE_URL ?? "").trim();
  const model = String(provider.model ?? env.SUBAGENTS_MODEL ?? "").trim();
  const apiKey = String(provider.apiKey ?? env.SUBAGENTS_API_KEY ?? "").trim();

  if (!baseUrl) {
    throw new Error(`provider.baseUrl is required for provider.kind "lmstudio-openai"`);
  }
  if (!model) {
    throw new Error(`provider.model is required for provider.kind "lmstudio-openai"`);
  }

  return { kind, baseUrl, model, apiKey: apiKey || null };
}
