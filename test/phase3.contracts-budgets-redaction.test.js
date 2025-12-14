import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { redactText } from "../src/safety/redaction.js";
import { WorkerPool } from "../src/runtime/worker_pool.js";
import { SubagentRuntime } from "../src/runtime/subagent_runtime.js";
import { researchCodebaseTool } from "../src/tools/research_codebase.js";

test("redactText redacts common token patterns and URL credentials", () => {
  assert.equal(redactText("hello world"), "hello world");

  const gh = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  assert.ok(!redactText(`token=${gh}`).includes(gh));

  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  assert.ok(!redactText(jwt).includes("eyJ"));

  const longToken = `${"A".repeat(31)}=`;
  assert.equal(redactText(`bearer ${longToken}`), "bearer [REDACTED]");

  const url = "https://user:pass@example.com/path";
  const redactedUrl = redactText(url);
  assert.ok(!redactedUrl.includes("user:pass@"));
  assert.ok(redactedUrl.includes("https://[REDACTED]@example.com"));

  const longSnakeCase = "convert_hf_to_gguf_update_py";
  assert.equal(redactText(longSnakeCase), longSnakeCase);
});

test("research_codebase output matches the Phase 3 contract and is deterministic", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase3-contract");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  await fs.writeFile(path.join(tmpRoot, "a.js"), "export const Alpha = 1;\n", "utf8");
  await fs.writeFile(path.join(tmpRoot, "b.js"), "export const Beta = 2;\n", "utf8");
  await fs.writeFile(path.join(tmpRoot, "c.txt"), "nothing\n", "utf8");

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };
  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 1 }) });

  const runOnce = async () => {
    const res = await researchCodebaseTool.handler({
      arguments: { question: "Where is Alpha implemented?", roots: [tmpRoot] },
      config,
      runtime,
      provider: null,
    });
    return JSON.parse(res.content[0].text);
  };

  const report1 = await runOnce();
  const report2 = await runOnce();

  assert.equal(report1.question, "Where is Alpha implemented?");
  assert.ok(Array.isArray(report1.rootsSearched));
  assert.equal(report1.rootsSearched[0], tmpRoot);

  assertIsRuntimeWrapper(report1.locator);
  assert.equal(report1.locator.status, "ok");
  assertIsNormalizedSubagentResult(report1.locator.value);

  const refs = report1.locator.value.references;
  assert.ok(refs.every((r) => isReferenceString(r)));
  assert.deepEqual(report1.locator.value.references, report2.locator.value.references);
});

test("budgets: limits.maxFilesRead truncates file scanning and is reported", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase3-budgets");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  for (let i = 0; i < 10; i += 1) {
    await fs.writeFile(path.join(tmpRoot, `f${i}.txt`), "Alpha\n", "utf8");
  }

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 3, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };
  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 1 }) });

  const res = await researchCodebaseTool.handler({
    arguments: { question: "Where is Alpha?", roots: [tmpRoot] },
    config,
    runtime,
    provider: null,
  });
  const report = JSON.parse(res.content[0].text);

  assert.equal(report.locator.status, "ok");
  assert.ok(report.locator.value.references.length <= 3);
  assert.ok(report.locator.value.notes?.includes("maxFilesRead"));
});

test("redaction: secrets in the question are not echoed back in the report", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase3-redaction");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });
  await fs.writeFile(path.join(tmpRoot, "x.txt"), "hello\n", "utf8");

  const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };
  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 1 }) });

  const res = await researchCodebaseTool.handler({
    arguments: { question: `Please help with token ${secret}`, roots: [tmpRoot] },
    config,
    runtime,
    provider: null,
  });

  const raw = res.content[0].text;
  assert.ok(!raw.includes(secret));
});

function assertIsRuntimeWrapper(value) {
  assert.ok(value && typeof value === "object");
  assert.ok(["ok", "timeout", "canceled", "error"].includes(value.status));
  assert.ok(value.timing && typeof value.timing.startedAt === "number");
  assert.ok(typeof value.timing.elapsedMs === "number");

  if (value.status === "ok") {
    assert.ok(value.value && typeof value.value === "object");
    assert.equal(value.error, undefined);
  } else {
    assert.ok(value.error && typeof value.error.message === "string");
    assert.equal(value.value, undefined);
  }
}

function assertIsNormalizedSubagentResult(value) {
  assert.equal(typeof value.summary, "string");
  assert.ok(Array.isArray(value.references));
  assert.ok(Array.isArray(value.key_findings));
  assert.ok(["low", "med", "high"].includes(value.confidence));
  assert.ok(value.notes === null || typeof value.notes === "string");
}

function isReferenceString(ref) {
  if (typeof ref !== "string" || ref.length === 0) return false;
  if (ref.includes("\n")) return false;
  return /^[^\s]+(?::\d+(?::\d+)?)?$/.test(ref);
}
