import { spawn } from "node:child_process";

const requests = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "cli", version: "0" } } },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ping", arguments: {} } },
  { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_roots", arguments: {} } },
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "research_codebase", arguments: { question: "Where is research_codebase implemented?" } },
  },
];

const proc = spawn(process.execPath, ["bin/subagents-mcp.js"], {
  stdio: ["pipe", "pipe", "inherit"],
});

proc.stdout.setEncoding("utf8");
proc.stdout.on("data", (chunk) => process.stdout.write(chunk));

for (const msg of requests) {
  proc.stdin.write(`${JSON.stringify(msg)}\n`);
}
proc.stdin.end();

const killTimer = setTimeout(() => proc.kill(), 5_000);
killTimer.unref?.();

const exitCode = await new Promise((resolve) => proc.on("close", resolve));
clearTimeout(killTimer);
process.exitCode = exitCode ?? 0;

