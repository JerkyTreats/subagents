import { writeJsonLine } from "./stdio.js";

const JSONRPC_VERSION = "2.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";

export class McpServer {
  constructor({ logger, serverInfo, tools, config }) {
    this.logger = logger;
    this.serverInfo = serverInfo;
    this.config = config;
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async handleMessage(message) {
    return this.#handleMessage(message);
  }

  startStdio({ stdin = process.stdin, stdout = process.stdout } = {}) {
    this.logger?.info?.("Starting MCP stdio server", {
      tools: Array.from(this.toolsByName.keys()).sort(),
    });

    stdin.setEncoding("utf8");
    if (typeof stdin.resume === "function") stdin.resume();

    let buffer = "";
    let queue = Promise.resolve();

    stdin.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        queue = queue.then(() => this.#handleLine({ line, stdout })).catch((error) => {
          this.logger?.error?.("MCP line handling failed", { error: error?.message ?? String(error) });
        });
      }
    });

    stdin.on("error", (error) => {
      this.logger?.error?.("MCP stdin error", { error: error?.message ?? String(error) });
      process.exitCode = 1;
    });
  }

  async #handleLine({ line, stdout }) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      writeJsonLine(stdout, jsonrpcErrorResponse(null, -32700, "Parse error"));
      return;
    }

    const response = await this.#handleMessage(message);
    if (response) writeJsonLine(stdout, response);
  }

  async #handleMessage(message) {
    if (!isObject(message) || message.jsonrpc !== JSONRPC_VERSION) {
      return jsonrpcErrorResponse(message?.id ?? null, -32600, "Invalid Request");
    }

    const { id, method, params } = message;
    const isNotification = id === undefined;

    try {
      if (method === "initialize") {
        const result = handleInitialize(params, this.serverInfo);
        return isNotification ? null : jsonrpcResultResponse(id, result);
      }

      if (method === "tools/list") {
        const result = {
          tools: Array.from(this.toolsByName.values())
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false },
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };
        return isNotification ? null : jsonrpcResultResponse(id, result);
      }

      if (method === "tools/call") {
        if (!isObject(params)) {
          return jsonrpcErrorResponse(id ?? null, -32602, "Invalid params");
        }
        const toolName = params.name;
        const toolArgs = params.arguments ?? {};
        if (typeof toolName !== "string" || toolName.trim().length === 0) {
          return jsonrpcErrorResponse(id ?? null, -32602, "Invalid params: missing tool name");
        }

        const tool = this.toolsByName.get(toolName);
        if (!tool) return jsonrpcErrorResponse(id ?? null, -32601, `Tool not found: ${toolName}`);

        const result = await tool.handler({
          arguments: toolArgs,
          config: this.config,
        });

        return isNotification ? null : jsonrpcResultResponse(id, result);
      }

      if (isNotification) return null;
      return jsonrpcErrorResponse(id, -32601, `Method not found: ${String(method)}`);
    } catch (error) {
      this.logger?.error?.("MCP request handling failed", {
        method,
        error: error?.message ?? String(error),
      });
      return isNotification ? null : jsonrpcErrorResponse(id ?? null, -32603, "Internal error");
    }
  }
}

function handleInitialize(params, serverInfo) {
  if (!isObject(params)) throw new Error("initialize params must be an object");

  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo,
    capabilities: {
      tools: {},
    },
  };
}

function jsonrpcResultResponse(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

function jsonrpcErrorResponse(id, code, message) {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
