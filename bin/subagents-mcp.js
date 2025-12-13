#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { McpServer } from "../src/mcp/server.js";
import { listRootsTool } from "../src/tools/list_roots.js";
import { pingTool } from "../src/tools/ping.js";

const config = loadConfig();
const logger = createLogger({ level: config.logging.level });

const server = new McpServer({
  logger,
  serverInfo: { name: "subagents-mcp", version: "0.1.0" },
  tools: [pingTool, listRootsTool],
  config,
});

server.startStdio();

