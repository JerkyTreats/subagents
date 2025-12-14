import fs from "node:fs/promises";
import path from "node:path";

import { redactText } from "../safety/redaction.js";

export async function runPatternFinderSubagent({
  question,
  roots,
  candidateReferences,
  keywords,
  config,
  signal,
}) {
  const maxFiles = config.compaction?.maxPatternFiles ?? 10;
  const maxBytesTotal = config.compaction?.maxPatternBytesRead ?? config.limits.maxBytesRead;
  const maxExamples = config.compaction?.maxPatterns ?? 6;
  const contextLines = config.compaction?.snippetContextLines ?? 0;

  const candidates = stableUnique(candidateReferences).slice(0, maxFiles);
  if (candidates.length === 0) {
    return {
      summary: "No candidate files to search for patterns (locator returned no references).",
      references: [],
      key_findings: [],
      confidence: "low",
      notes: null,
    };
  }

  let bytesRead = 0;
  const references = [];
  const findings = [];

  for (const ref of candidates) {
    if (references.length >= maxExamples) break;
    if (signal?.aborted) {
      const error = new Error("Aborted");
      error.name = "AbortError";
      throw error;
    }
    const absPath = resolveReferenceToAbsolutePath(ref, roots);
    if (!absPath) continue;

    let raw;
    try {
      const stat = await fs.stat(absPath);
      if (!stat.isFile()) continue;
      if (stat.size > maxBytesTotal) continue;
      if (bytesRead + stat.size > maxBytesTotal) break;
      raw = await fs.readFile(absPath, "utf8");
      bytesRead += stat.size;
    } catch {
      continue;
    }

    const rel = referenceToRelative(absPath, roots);
    const lines = raw.split(/\r?\n/);
    const hits = findKeywordHits(lines, keywords);
    for (const hit of hits) {
      if (references.length >= maxExamples) break;
      const snippet = buildSnippet(lines, hit.line - 1, contextLines);
      const lineRef = `${rel}:${hit.line}`;
      references.push(lineRef);
      findings.push(`${lineRef}\n${redactText(snippet).trim()}`);
    }
  }

  const dedupedRefs = stableUnique(references).sort((a, b) => a.localeCompare(b));
  const dedupedFindings = stableUnique(findings).slice(0, maxExamples);

  return {
    summary: `Found ${dedupedRefs.length} example(s) across ${Math.min(candidates.length, maxFiles)} file(s).`,
    references: dedupedRefs,
    key_findings: dedupedFindings,
    confidence: dedupedRefs.length > 0 ? "med" : "low",
    notes: bytesRead >= maxBytesTotal ? "pattern scan hit max byte budget" : null,
  };
}

function buildSnippet(lines, index, contextLines) {
  const start = Math.max(0, index - contextLines);
  const end = Math.min(lines.length, index + contextLines + 1);
  return lines.slice(start, end).join("\n");
}

function findKeywordHits(lines, keywords) {
  const needles = (keywords ?? []).map((k) => String(k).toLowerCase()).filter(Boolean);
  if (needles.length === 0) return [];

  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hay = line.toLowerCase();
    if (needles.some((n) => hay.includes(n))) hits.push({ line: i + 1, text: line });
  }
  return hits;
}

function resolveReferenceToAbsolutePath(reference, roots) {
  if (typeof reference !== "string" || reference.length === 0) return null;
  const filePart = reference.split(":")[0];
  if (path.isAbsolute(filePart)) return filePart;
  for (const root of roots) {
    const abs = path.resolve(root, filePart);
    const rel = path.relative(root, abs);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return abs;
  }
  return null;
}

function referenceToRelative(absPath, roots) {
  for (const root of roots) {
    const rel = path.relative(root, absPath);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep).join("/");
  }
  return absPath;
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
