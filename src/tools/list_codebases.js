import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([
  ".git",
  "node_modules",
  ".venv",
  ".cache",
  ".DS_Store",
  "dist",
  "build",
  ".test-tmp",
  "artifacts",
]);

const MANIFESTS = Object.freeze([
  { file: "package.json", tag: "node" },
  { file: "pyproject.toml", tag: "python" },
  { file: "requirements.txt", tag: "python" },
  { file: "Pipfile", tag: "python" },
  { file: "poetry.lock", tag: "python" },
  { file: "Cargo.toml", tag: "rust" },
  { file: "go.mod", tag: "go" },
  { file: "Gemfile", tag: "ruby" },
  { file: "pom.xml", tag: "java" },
  { file: "build.gradle", tag: "java" },
  { file: "CMakeLists.txt", tag: "cpp" },
  { file: "Makefile", tag: "build" },
]);

export const listCodebasesTool = {
  name: "list_codebases",
  description:
    "Discover likely codebases under the configured roots by scanning for .git folders and common manifest files (no content search).",
  inputSchema: {
    type: "object",
    properties: {
      roots: { type: "array", items: { type: "string" } },
      maxDepth: { type: "integer", minimum: 0 },
      maxDirs: { type: "integer", minimum: 1 },
      maxProjects: { type: "integer", minimum: 1 },
      includeNonGit: { type: "boolean" },
      includeNested: { type: "boolean" },
    },
    additionalProperties: false,
  },
  async handler({ arguments: args, config }) {
    const roots = resolveRequestedRoots({
      requested: args?.roots ?? null,
      allowed: config.roots,
    });

    const maxDepth = coerceNonNegativeInt(args?.maxDepth ?? 4, "maxDepth");
    const maxDirs = coercePositiveInt(args?.maxDirs ?? 20_000, "maxDirs");
    const maxProjects = coercePositiveInt(args?.maxProjects ?? 500, "maxProjects");
    const includeNonGit = Boolean(args?.includeNonGit ?? true);
    const includeNested = Boolean(args?.includeNested ?? false);

    const { projects, stats } = await scanForCodebases({
      roots,
      maxDepth,
      maxDirs,
      maxProjects,
      includeNonGit,
      includeNested,
    });

    const payload = {
      rootsSearched: roots,
      projects,
      stats,
    };

    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
  },
};

async function scanForCodebases({
  roots,
  maxDepth,
  maxDirs,
  maxProjects,
  includeNonGit,
  includeNested,
}) {
  const queue = roots.map((root) => ({ dir: path.resolve(root), depth: 0 }));
  const seenDirs = new Set();
  const projects = [];
  const projectRoots = new Set();

  let dirsScanned = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (dirsScanned >= maxDirs) {
      truncated = true;
      break;
    }
    if (projects.length >= maxProjects) {
      truncated = true;
      break;
    }

    const { dir, depth } = queue.shift();
    const resolved = path.resolve(dir);
    if (seenDirs.has(resolved)) continue;
    seenDirs.add(resolved);
    dirsScanned += 1;

    let entries;
    try {
      entries = await fs.readdir(resolved, { withFileTypes: true });
    } catch {
      continue;
    }

    const entryByName = new Map(entries.map((e) => [e.name, e]));
    const hasGit = isGitRepo(entryByName);

    const manifestHits = MANIFESTS.filter((m) => entryByName.get(m.file)?.isFile?.());
    const tags = stableUnique(manifestHits.map((m) => m.tag));

    const isProject = hasGit || (includeNonGit && manifestHits.length > 0);
    if (isProject) {
      const rel = toWorkspaceRelative(resolved, roots);
      const key = rel;
      if (!projectRoots.has(key)) {
        projectRoots.add(key);
        projects.push({
          root: rel,
          git: hasGit,
          tags,
          manifests: manifestHits.map((m) => m.file).sort((a, b) => a.localeCompare(b)),
          name: await inferProjectName({ dir: resolved, rel, entryByName }),
        });
      }
    }

    if (depth >= maxDepth) continue;
    if (hasGit && !includeNested) continue;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (DEFAULT_IGNORES.has(entry.name)) continue;
      queue.push({ dir: path.join(resolved, entry.name), depth: depth + 1 });
    }
  }

  projects.sort((a, b) => a.root.localeCompare(b.root));

  return {
    projects,
    stats: {
      dirsScanned,
      projectsFound: projects.length,
      truncated,
      maxDepth,
      maxDirs,
      maxProjects,
    },
  };
}

function isGitRepo(entryByName) {
  const dotGit = entryByName.get(".git");
  if (!dotGit) return false;
  if (typeof dotGit.isDirectory === "function" && dotGit.isDirectory()) return true;
  if (typeof dotGit.isFile === "function" && dotGit.isFile()) return true;
  return false;
}

async function inferProjectName({ dir, rel, entryByName }) {
  // Prefer explicit manifest names; otherwise use leaf folder name.
  const packageJson = entryByName.get("package.json");
  if (packageJson?.isFile?.()) {
    const parsed = await tryReadJson(path.join(dir, "package.json"));
    if (parsed && typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
  }

  const cargoToml = entryByName.get("Cargo.toml");
  if (cargoToml?.isFile?.()) {
    const raw = await tryReadText(path.join(dir, "Cargo.toml"), 64 * 1024);
    const name = raw ? matchTomlName(raw) : null;
    if (name) return name;
  }

  const pyproject = entryByName.get("pyproject.toml");
  if (pyproject?.isFile?.()) {
    const raw = await tryReadText(path.join(dir, "pyproject.toml"), 64 * 1024);
    const name = raw ? matchTomlName(raw) : null;
    if (name) return name;
  }

  return path.basename(rel || dir);
}

function matchTomlName(raw) {
  // Heuristic; avoids a TOML dependency.
  const match = raw.match(/^\s*name\s*=\s*["']([^"']+)["']\s*$/m);
  if (!match) return null;
  const name = match[1]?.trim();
  return name ? name : null;
}

async function tryReadText(filePath, maxBytes) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    if (stat.size > maxBytes) return null;
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function tryReadJson(filePath) {
  const raw = await tryReadText(filePath, 256 * 1024);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toWorkspaceRelative(absDir, roots) {
  for (const root of roots) {
    const rel = path.relative(root, absDir);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const normalized = rel.split(path.sep).join("/");
      return normalized.length === 0 ? "." : normalized;
    }
  }
  return absDir;
}

function resolveRequestedRoots({ requested, allowed }) {
  const allowedResolved = allowed.map((root) => path.resolve(root));
  const allowedSet = new Set(allowedResolved);

  if (!requested) return allowedResolved;
  if (!Array.isArray(requested)) throw new Error("Invalid roots; expected array of strings");

  const resolved = requested.map((r) => path.resolve(String(r)));
  for (const root of resolved) {
    if (!isWithinAnyAllowedRoot(root, allowedResolved, allowedSet)) {
      throw new Error(`Root not allowed: ${root}`);
    }
  }
  return Array.from(new Set(resolved)).sort();
}

function isWithinAnyAllowedRoot(root, allowedResolved, allowedSet) {
  if (allowedSet.has(root)) return true;
  for (const allowed of allowedResolved) {
    const rel = path.relative(allowed, root);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return true;
  }
  return false;
}

function stableUnique(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function coercePositiveInt(value, label) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber <= 0 || !Number.isInteger(asNumber)) {
    const error = new Error(`Invalid input: ${label} must be a positive integer`);
    error.name = "ToolInputError";
    throw error;
  }
  return asNumber;
}

function coerceNonNegativeInt(value, label) {
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber) || asNumber < 0 || !Number.isInteger(asNumber)) {
    const error = new Error(`Invalid input: ${label} must be a non-negative integer`);
    error.name = "ToolInputError";
    throw error;
  }
  return asNumber;
}

