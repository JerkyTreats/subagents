import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { WorkerPool } from "../src/runtime/worker_pool.js";
import { SubagentRuntime } from "../src/runtime/subagent_runtime.js";
import { researchCodebaseTool } from "../src/tools/research_codebase.js";

test("Phase 4: research_codebase runs locator+analyzer+patterns and synthesizes with deduped references", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase4-pipeline");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  await fs.writeFile(path.join(tmpRoot, "alpha.js"), "export function Alpha() {}\n", "utf8");
  await fs.writeFile(path.join(tmpRoot, "beta.js"), "export const Beta = 1;\n", "utf8");

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 2, defaultDeadlineMs: 1000 },
    compaction: {
      maxAnalyzerFiles: 5,
      maxPatternFiles: 10,
      maxPatterns: 6,
      maxKeyFindings: 24,
      snippetContextLines: 0,
      maxAnalyzerBytesRead: 1024 * 1024,
      maxPatternBytesRead: 1024 * 1024,
    },
    artifacts: { enabled: false, dir: "artifacts" },
    provider: { kind: null },
    logging: { level: "error" },
  };

  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 2 }) });
  const res = await researchCodebaseTool.handler({
    arguments: { question: "Where is Alpha implemented?", roots: [tmpRoot] },
    config,
    runtime,
    provider: null,
  });

  const report = JSON.parse(res.content[0].text);
  assert.equal(report.locator.status, "ok");
  assert.equal(report.analyzer.status, "ok");
  assert.equal(report.patterns.status, "ok");

  assert.ok(report.synthesis);
  assert.ok(Array.isArray(report.synthesis.references));
  assert.deepEqual([...report.synthesis.references].sort(), report.synthesis.references);

  const unique = new Set(report.synthesis.references);
  assert.equal(unique.size, report.synthesis.references.length);
});

test("Phase 4: artifact writing happens only when requested and enabled, and is redacted", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase4-artifacts");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  await fs.writeFile(path.join(tmpRoot, "token.txt"), `token=${secret}\n`, "utf8");

  const artifactsDir = path.join(tmpRoot, "artifacts-out");
  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 2, defaultDeadlineMs: 1000 },
    compaction: {
      maxAnalyzerFiles: 5,
      maxPatternFiles: 10,
      maxPatterns: 6,
      maxKeyFindings: 24,
      snippetContextLines: 0,
      maxAnalyzerBytesRead: 1024 * 1024,
      maxPatternBytesRead: 1024 * 1024,
    },
    artifacts: { enabled: true, dir: artifactsDir },
    provider: { kind: null },
    logging: { level: "error" },
  };

  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 2 }) });
  const res = await researchCodebaseTool.handler({
    arguments: { question: `Please analyze ${secret}`, roots: [tmpRoot], artifact: true },
    config,
    runtime,
    provider: null,
  });

  const report = JSON.parse(res.content[0].text);
  assert.ok(report.artifact);

  const artifactPath = report.artifact;
  assert.ok(artifactPath.includes("artifacts-out"));
  const md = await fs.readFile(artifactPath, "utf8");
  assert.ok(!md.includes(secret));
});

