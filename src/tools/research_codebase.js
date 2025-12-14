import path from "node:path";

import { runAnalyzerSubagent, heuristicKeywordsFromQuestion } from "../subagents/analyzer.js";
import { runLocatorSubagent } from "../subagents/locator.js";
import { runPatternFinderSubagent } from "../subagents/pattern_finder.js";
import { writeResearchArtifact } from "../artifacts/write_artifact.js";
import { redactJson } from "../safety/redaction.js";
import { synthesizeResearchReport } from "../synthesis/synthesize_report.js";

export const researchCodebaseTool = {
  name: "research_codebase",
  description: "Spawn subagents to locate relevant code and return a compact, referenced report.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      roots: { type: "array", items: { type: "string" } },
      constraints: { type: "object" },
      artifact: { type: ["boolean", "object"] },
    },
    required: ["question"],
    additionalProperties: false,
  },
  async handler({ arguments: args, config, runtime, provider }) {
    const question = String(args.question ?? "").trim();
    if (!question) {
      const error = new Error("Invalid input: question is required");
      error.name = "ToolInputError";
      throw error;
    }
    if (!runtime) {
      throw new Error("Server misconfigured: runtime is required");
    }

    const roots = resolveRequestedRoots({
      requested: args.roots ?? null,
      allowed: config.roots,
    });

    const keywords = heuristicKeywordsFromQuestion(question);

    const locatorTask = {
      role: "locator",
      deadlineMs: args.constraints?.deadlineMs,
      async run({ signal }) {
        return runLocatorSubagent({
          question,
          roots,
          config,
          provider,
          signal,
        });
      },
    };

    const locator = await runtime.run(locatorTask);

    const candidateRefs = locator.status === "ok" ? locator.value.references : [];

    const analyzerTask = {
      role: "analyzer",
      deadlineMs: args.constraints?.deadlineMs,
      async run({ signal }) {
        return runAnalyzerSubagent({
          question,
          roots,
          candidateReferences: candidateRefs,
          keywords,
          config,
          signal,
        });
      },
    };

    const patternTask = {
      role: "pattern_finder",
      deadlineMs: args.constraints?.deadlineMs,
      async run({ signal }) {
        return runPatternFinderSubagent({
          question,
          roots,
          candidateReferences: candidateRefs,
          keywords,
          config,
          signal,
        });
      },
    };

    const [analyzer, patterns] = await Promise.all([runtime.run(analyzerTask), runtime.run(patternTask)]);

    const synthesis = synthesizeResearchReport({ question, locator, analyzer, patterns });

    const report = {
      question,
      rootsSearched: roots,
      locator,
      analyzer,
      patterns,
      synthesis,
    };

    let artifactPath = null;
    const artifactRequest = args.artifact ?? false;
    const artifactEnabled =
      artifactRequest === true || (artifactRequest && typeof artifactRequest === "object");

    if (artifactEnabled) {
      if (!config.artifacts?.enabled) {
        artifactPath = null;
      } else {
        const dir = typeof artifactRequest === "object" ? artifactRequest.dir : undefined;
        artifactPath = await writeResearchArtifact({
          cwd: process.cwd(),
          dir: dir ?? config.artifacts.dir,
          report,
          limits: config.limits,
        });
      }
    }

    const redacted = redactJson({ ...report, artifact: artifactPath });
    return { content: [{ type: "text", text: JSON.stringify(redacted, null, 2) }] };
  },
};

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
