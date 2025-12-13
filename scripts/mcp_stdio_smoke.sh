#!/usr/bin/env bash
set -euo pipefail

node bin/subagents-mcp.js <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"cli","version":"0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ping","arguments":{}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_roots","arguments":{}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"research_codebase","arguments":{"question":"Where is research_codebase implemented?"}}}
EOF

