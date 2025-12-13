import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import { McpServer } from "../src/mcp/server.js";
import { listRootsTool } from "../src/tools/list_roots.js";
import { pingTool } from "../src/tools/ping.js";

test("config loads defaults and resolves roots", () => {
  const cfg = loadConfig({ cwd: "/tmp/example", env: {} });
  assert.ok(Array.isArray(cfg.roots));
  assert.equal(cfg.roots.length, 1);
  assert.equal(cfg.roots[0], path.resolve("/tmp/example", "."));
  assert.equal(cfg.logging.level, "info");
});

test("MCP server exposes ping + list_roots and validates params", async () => {
  const rootA = "/example/root-a";
  const rootB = "/example/root-b";

  const server = new McpServer({
    logger: null,
    serverInfo: { name: "subagents-mcp", version: "test" },
    tools: [pingTool, listRootsTool],
    config: {
      roots: [rootA, rootB],
      limits: { maxFilesRead: 1, maxBytesRead: 1 },
      logging: { level: "error" },
    },
  });

  const init = await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "test", version: "0" } },
  });
  assert.equal(init.result.protocolVersion, "2024-11-05");

  const list = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const toolNames = list.result.tools.map((t) => t.name);
  assert.deepEqual(toolNames.sort(), ["list_roots", "ping"]);

  const ping = await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "ping", arguments: {} },
  });
  assert.equal(ping.result.content?.[0]?.text, "pong");

  const roots = await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "list_roots", arguments: {} },
  });
  const parsed = JSON.parse(roots.result.content?.[0]?.text ?? "{}");
  assert.deepEqual(parsed.roots.sort(), [rootA, rootB].sort());

  const missingName = await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { arguments: {} },
  });
  assert.equal(missingName.error.code, -32602);
});
