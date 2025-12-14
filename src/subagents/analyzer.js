import fs from "node:fs/promises";
import path from "node:path";

import { redactText } from "../safety/redaction.js";

export async function runAnalyzerSubagent({
  question,
  roots,
  candidateReferences,
  keywords,
  config,
  signal,
}) {
  const maxFiles = config.compaction?.maxAnalyzerFiles ?? 5;
  const maxBytesTotal = config.compaction?.maxAnalyzerBytesRead ?? config.limits.maxBytesRead;
  const maxFindings = config.compaction?.maxKeyFindings ?? 12;

  const candidates = stableUnique(candidateReferences).slice(0, maxFiles);
  if (candidates.length === 0) {
    return {
      summary: "No candidate files to analyze (locator returned no references).",
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
    for (const hit of hits.slice(0, 6)) {
      const lineRef = `${rel}:${hit.line}`;
      references.push(lineRef);
      if (findings.length < maxFindings) {
        const code = redactText(hit.text.trim()).slice(0, 200);
        findings.push(`${lineRef} ${code}`);
      }
    }
  }

  const dedupedRefs = stableUnique(references).sort((a, b) => a.localeCompare(b));
  const dedupedFindings = stableUnique(findings).slice(0, maxFindings);

  const confidence =
    dedupedRefs.length > 0 ? (dedupedRefs.length >= 5 ? "high" : "med") : "low";

  return {
    summary: `Scanned ${candidates.length} file(s) for evidence; found ${dedupedRefs.length} match reference(s).`,
    references: dedupedRefs,
    key_findings: dedupedFindings,
    confidence,
    notes: bytesRead >= maxBytesTotal ? "analysis hit max byte budget" : null,
  };
}

export function heuristicKeywordsFromQuestion(question) {
  if (!question) return [];
  const tokens = String(question)
    .split(/[^a-zA-Z0-9_]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  return stableUnique(tokens).slice(0, 12);
}

function findKeywordHits(lines, keywords) {
  const needles = (keywords ?? []).map((k) => String(k).toLowerCase()).filter(Boolean);
  if (needles.length === 0) return [];

  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const hay = line.toLowerCase();
    if (needles.some((n) => hay.includes(n))) {
      hits.push({ line: i + 1, text: line });
    }
  }
  return hits;
}

function resolveReferenceToAbsolutePath(reference, roots) {
  if (typeof reference !== "string" || reference.length === 0) return null;
  const filePart = reference.split(":")[0];
  if (path.isAbsolute(filePart)) return filePart;
  for (const root of roots) {
    const abs = path.resolve(root, filePart);
    // Ensure within root to avoid traversal
    const rel = path.relative(root, abs);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) return abs;
  }
  return null;
}

function referenceToRelative(absPath, roots) {
  for (const root of roots) {
    const rel = path.relative(root, absPath);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      return rel.split(path.sep).join("/");
    }
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
