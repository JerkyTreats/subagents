import path from "node:path";

import { runLocatorSubagent } from "../subagents/locator.js";
import { redactJson } from "../safety/redaction.js";

export const researchCodebaseTool = {
  name: "research_codebase",
  description: "Spawn subagents to locate relevant code and return a compact, referenced report.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      roots: { type: "array", items: { type: "string" } },
      constraints: { type: "object" },
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

    const result = await runtime.run(locatorTask);

    const report = {
      question,
      rootsSearched: roots,
      locator: result,
    };

    const redacted = redactJson(report);
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
