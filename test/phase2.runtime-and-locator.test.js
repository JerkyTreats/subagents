import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { WorkerPool } from "../src/runtime/worker_pool.js";
import { SubagentRuntime } from "../src/runtime/subagent_runtime.js";
import { runLocatorSubagent } from "../src/subagents/locator.js";
import { researchCodebaseTool } from "../src/tools/research_codebase.js";
import { McpServer } from "../src/mcp/server.js";
import { pingTool } from "../src/tools/ping.js";
import { listRootsTool } from "../src/tools/list_roots.js";

test("WorkerPool enforces max concurrency", async () => {
  const pool = new WorkerPool({ maxConcurrent: 2 });
  let active = 0;
  let maxActive = 0;

  await Promise.all(
    Array.from({ length: 6 }, () =>
      pool.run(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(30);
        active -= 1;
      }),
    ),
  );

  assert.equal(maxActive, 2);
});

test("SubagentRuntime times out tasks past deadline", async () => {
  const runtime = new SubagentRuntime({
    workerPool: new WorkerPool({ maxConcurrent: 1 }),
    defaultDeadlineMs: 25,
  });

  const result = await runtime.run({
    async run() {
      await sleep(100);
      return "done";
    },
  });

  assert.equal(result.status, "timeout");
});

test("Locator returns referenced file paths (no large excerpts)", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase2-locator");
  await fs.mkdir(tmpRoot, { recursive: true });

  const srcDir = path.join(tmpRoot, "src");
  await fs.mkdir(srcDir, { recursive: true });
  await fs.writeFile(path.join(srcDir, "foo.js"), "export function FooService() {}\n", "utf8");
  await fs.writeFile(path.join(srcDir, "bar.js"), "const x = 1;\n", "utf8");

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };

  const locator = await runLocatorSubagent({
    question: "Where is FooService implemented?",
    roots: [tmpRoot],
    config,
    provider: null,
  });

  assert.equal(typeof locator.summary, "string");
  assert.ok(Array.isArray(locator.references));
  assert.ok(locator.references.some((p) => p.includes("src/foo.js")));
  assert.ok(!JSON.stringify(locator).includes("export function FooService"));
});

test("research_codebase tool runs Locator via runtime", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase2-research");
  await fs.mkdir(tmpRoot, { recursive: true });
  await fs.writeFile(path.join(tmpRoot, "x.js"), "class Widget {}\n", "utf8");

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };

  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 1 }) });
  const toolResult = await researchCodebaseTool.handler({
    arguments: { question: "Where is Widget?", roots: [tmpRoot] },
    config,
    runtime,
    provider: null,
  });

  const report = JSON.parse(toolResult.content[0].text);
  assert.equal(report.question, "Where is Widget?");
  assert.equal(report.locator.status, "ok");
  assert.ok(report.locator.value.references.some((p) => p.includes("x.js")));
});

test("MCP server maps tool input errors to JSON-RPC -32602", async () => {
  const config = {
    roots: [process.cwd()],
    limits: { maxFilesRead: 1, maxBytesRead: 1 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };
  const runtime = new SubagentRuntime({ workerPool: new WorkerPool({ maxConcurrent: 1 }) });

  const server = new McpServer({
    logger: null,
    serverInfo: { name: "subagents-mcp", version: "test" },
    tools: [pingTool, listRootsTool, researchCodebaseTool],
    config,
    context: { runtime, provider: null },
  });

  const response = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "research_codebase", arguments: {} },
  });

  assert.equal(response.error.code, -32602);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

