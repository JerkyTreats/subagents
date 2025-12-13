import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_IGNORES = new Set([".git", "node_modules", ".test-tmp"]);

export async function findFiles({ roots, maxFiles = 10_000, ignoreNames = DEFAULT_IGNORES }) {
  const results = [];
  let truncated = false;
  const queue = roots.map((root) => path.resolve(root));

  while (queue.length > 0) {
    const dir = queue.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (ignoreNames.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
        if (results.length >= maxFiles) {
          truncated = true;
          return { files: results, truncated };
        }
      }
    }
  }

  return { files: results, truncated };
}

export async function searchFilesForAny({ files, needles, maxBytesRead = 1024 * 1024, maxMatches = 200 }) {
  const normalizedNeedles = needles
    .map((n) => String(n).trim())
    .filter((n) => n.length > 0);

  if (normalizedNeedles.length === 0) {
    return { matches: [], truncated: false, bytesRead: 0, filesScanned: 0 };
  }

  let bytesRead = 0;
  let truncated = false;
  let filesScanned = 0;
  const matches = [];

  for (const file of files) {
    if (matches.length >= maxMatches) break;
    let content;
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile()) continue;
      if (stat.size > maxBytesRead) continue;
      if (bytesRead + stat.size > maxBytesRead) break;
      content = await fs.readFile(file, "utf8");
      bytesRead += stat.size;
      filesScanned += 1;
    } catch {
      continue;
    }

    const haystack = content.toLowerCase();
    const hit = normalizedNeedles.some((needle) => haystack.includes(needle.toLowerCase()));
    if (hit) matches.push(file);
  }

  if (matches.length >= maxMatches) truncated = true;
  if (filesScanned < files.length) truncated = true;

  return { matches, truncated, bytesRead, filesScanned };
}
