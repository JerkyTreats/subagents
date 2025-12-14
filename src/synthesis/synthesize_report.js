import { redactText } from "../safety/redaction.js";

export function synthesizeResearchReport({ question, locator, analyzer, patterns }) {
  const references = stableUnique([
    ...(locator?.value?.references ?? []),
    ...(analyzer?.value?.references ?? []),
    ...(patterns?.value?.references ?? []),
  ]).sort((a, b) => a.localeCompare(b));

  const findings = stableUnique([
    ...(locator?.value?.key_findings ?? []),
    ...(analyzer?.value?.key_findings ?? []),
    ...(patterns?.value?.key_findings ?? []),
  ]).slice(0, 24);

  const partial = [locator, analyzer, patterns]
    .filter(Boolean)
    .some((r) => r.status !== "ok");

  const summaryParts = [];
  if (locator) summaryParts.push(`locator: ${locator.status}`);
  if (analyzer) summaryParts.push(`analyzer: ${analyzer.status}`);
  if (patterns) summaryParts.push(`patterns: ${patterns.status}`);

  const summary = redactText(
    `${partial ? "Partial results" : "Results"} for: ${question} (${summaryParts.join(", ")})`,
  );

  return {
    summary,
    key_findings: findings,
    references,
  };
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

