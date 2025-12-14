#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { McpServer } from "../src/mcp/server.js";
import { LmStudioOpenAIProvider } from "../src/providers/lmstudio_openai.js";
import { SubagentRuntime } from "../src/runtime/subagent_runtime.js";
import { WorkerPool } from "../src/runtime/worker_pool.js";
import { listRootsTool } from "../src/tools/list_roots.js";
import { listCodebasesTool } from "../src/tools/list_codebases.js";
import { pingTool } from "../src/tools/ping.js";
import { researchCodebaseTool } from "../src/tools/research_codebase.js";

const config = loadConfig();
const logger = createLogger({ level: config.logging.level });

const workerPool = new WorkerPool({ maxConcurrent: config.runtime.maxConcurrentTasks });
const runtime = new SubagentRuntime({
  workerPool,
  defaultDeadlineMs: config.runtime.defaultDeadlineMs,
});

const provider =
  config.provider.kind === "lmstudio-openai"
    ? new LmStudioOpenAIProvider({
        baseUrl: config.provider.baseUrl,
        model: config.provider.model,
        apiKey: config.provider.apiKey,
      })
    : null;

const server = new McpServer({
  logger,
  serverInfo: { name: "subagents-mcp", version: "0.1.0" },
  tools: [pingTool, listRootsTool, listCodebasesTool, researchCodebaseTool],
  config,
  context: { runtime, provider, logger },
});

server.startStdio();
