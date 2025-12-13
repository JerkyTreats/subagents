import path from "node:path";

import { findFiles, searchFilesForAny } from "../tools/fs_search.js";
import { redactText } from "../safety/redaction.js";

export async function runLocatorSubagent({
  question,
  roots,
  config,
  provider = null,
  signal,
}) {
  const keywords = await extractKeywords({ question, provider, signal });
  const fileScan = await findFiles({ roots, maxFiles: config.limits.maxFilesRead });
  const matchScan = await searchFilesForAny({
    files: fileScan.files,
    needles: keywords,
    maxBytesRead: config.limits.maxBytesRead,
  });

  const references = stableUnique(matchScan.matches)
    .map((file) => fileToWorkspaceRelative(file, roots))
    .sort((a, b) => a.localeCompare(b));

  const truncationNotes = [];
  if (fileScan.truncated) truncationNotes.push("file scan hit limits.maxFilesRead");
  if (matchScan.truncated) truncationNotes.push("content scan hit limits.maxBytesRead and/or maxMatches");

  return {
    summary: `Found ${references.length} relevant file(s).`,
    references,
    key_findings: [
      redactText(
        `Keywords: ${keywords.slice(0, 8).join(", ")}${keywords.length > 8 ? ", …" : ""}`,
      ),
    ],
    confidence: references.length > 0 ? "med" : "low",
    notes: truncationNotes.length > 0 ? truncationNotes.join("; ") : null,
  };
}

async function extractKeywords({ question, provider, signal }) {
  const fallback = heuristicKeywords(question);
  if (!provider) return fallback;

  const prompt = [
    "Extract 3-8 concise search keywords from the question.",
    "Return strict JSON: {\"keywords\":[\"...\"]}. No other text.",
    `Question: ${question}`,
  ].join("\n");

  try {
    const content = await provider.chatCompletion({
      messages: [
        { role: "system", content: "You extract search keywords as strict JSON." },
        { role: "user", content: prompt },
      ],
      temperature: 0,
      maxTokens: 128,
      signal,
    });
    const parsed = JSON.parse(content);
    const keywords = Array.isArray(parsed?.keywords) ? parsed.keywords : null;
    if (!keywords) return fallback;
    const cleaned = keywords.map((k) => String(k).trim()).filter(Boolean);
    return cleaned.length > 0 ? cleaned.slice(0, 12) : fallback;
  } catch {
    return fallback;
  }
}

function heuristicKeywords(question) {
  if (!question) return [];
  const tokens = String(question)
    .split(/[^a-zA-Z0-9_]+/g)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  const unique = stableUnique(tokens);
  return unique.slice(0, 12);
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

function fileToWorkspaceRelative(file, roots) {
  for (const root of roots) {
    const rel = path.relative(root, file);
    if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
      const normalized = rel.split(path.sep).join("/");
      return normalized.length === 0 ? "." : normalized;
    }
  }
  return file;
}
