# MCP Subagent Tool with Context Compaction

This project implements an MCP (Model Context Protocol) subagent tool using context compaction strategies.

## Source Attribution

This project contains agent prompt patterns and orchestration strategies adapted from the [HumanLayer project](https://github.com/humanlayer/humanlayer).

**Copyright**: (c) 2024, humanlayer Authors
**License**: Apache License 2.0 (see LICENSE file)
**Original Repository**: https://github.com/humanlayer/humanlayer

## Project Structure

```
/subagents/
├── bin/                       # Executable entrypoints
│   └── subagents-mcp.js               # MCP stdio server (Phase 1)
├── agents/                    # Specialized agent prompt definitions
│   ├── codebase-analyzer.md           # Deep analysis of code implementation
│   ├── codebase-locator.md            # Finding where code lives
│   ├── codebase-pattern-finder.md     # Locating similar patterns/examples
│   ├── thoughts-analyzer.md           # Extracting insights from documents
│   ├── thoughts-locator.md            # Finding relevant documents
│   └── web-search-researcher.md       # Web research with synthesis
├── docs/                      # Design docs/specs
│   └── subagent_compaction_tool_spec.md
├── examples/                  # Example orchestration patterns
│   ├── create_handoff.md              # Explicit compaction strategy
│   ├── research_codebase.md           # Multi-agent orchestration
│   └── resume_handoff.md              # Synthesis pattern example
├── src/                       # Implementation (no external deps)
│   ├── config.js                      # Config loader/validation
│   ├── logger.js                      # Minimal logger
│   ├── mcp/                           # MCP JSON-RPC stdio plumbing
│   └── tools/                         # Phase 1 tools (ping, list_roots)
├── LICENSE                    # Apache 2.0 license
├── mcp.json                    # LM Studio MCP plugin config (example)
├── subagents.config.json       # Default config (roots/limits/logging)
├── subagents.config.example.json
└── README.md                  # This file
```

## Phase 1: MCP Server (stdio)

Run locally:
- `npm test`
- `npm start`
- `node scripts/mcp_stdio_smoke.mjs`

Tools:
- `ping`
- `list_roots`
- `research_codebase` (Phase 2)

### LM Studio
`mcp.json` is included as a starting point. Adjust paths as needed for your LM Studio setup.

## Key Compaction Strategies

### 1. Specialized Agent Architecture
Each agent has a focused role that returns only relevant information:
- **Locators**: Return file paths and locations, not content
- **Analyzers**: Deep dive with file:line references, filtered insights
- **Pattern Finders**: Concrete examples with context

### 2. File:Line Reference System
Instead of including large code blocks, agents return references like:
- `path/to/file.ext:123` - Single line reference
- `path/to/file.ext:45-67` - Range reference

### 3. Parallel Processing Pattern
Main agent spawns multiple specialized subagents in parallel, then synthesizes results:
```
Main Agent
  ├─> Locator Agent (finds WHERE)
  ├─> Analyzer Agent (understands HOW)
  ├─> Pattern Agent (finds EXAMPLES)
  └─> Synthesize all results
```

### 4. Aggressive Filtering (thoughts-analyzer)
Transforms verbose documents into actionable insights:
- Skip tangential mentions
- Remove outdated information
- Extract only decisions, constraints, specifications
- Focus on "what matters NOW"

### 5. Handoff Documents
Explicit compaction strategy for session continuity:
- Structured sections (Tasks, Learnings, Artifacts, Next Steps)
- Prefer references over inclusion
- Avoid excessive code snippets

## Agent Descriptions

### Codebase Agents

**codebase-locator** - "Super Grep/Glob/LS tool"
- Finds WHERE code lives
- Returns organized file paths, not content
- Categorizes by purpose (implementation, tests, config, etc.)

**codebase-analyzer** - Deep implementation analysis
- Understands HOW code works
- Traces data flow with file:line references
- Documents patterns without critique

**codebase-pattern-finder** - Example finder
- Locates similar implementations
- Shows concrete code examples
- Provides multiple variations with context

### Document Agents

**thoughts-locator** - Document discovery
- Finds relevant documents in knowledge directories
- Categorizes by type (tickets, research, plans, etc.)
- Returns paths, not full content

**thoughts-analyzer** - Insight extraction
- Extracts high-value insights only
- Filters aggressively for relevance
- Returns decisions, constraints, specifications

### Research Agent

**web-search-researcher** - Web research specialist
- Strategic search execution
- Content fetching and analysis
- Synthesized findings with sources

## Usage Pattern

1. **Decompose** - Break complex queries into focused research areas
2. **Spawn** - Launch multiple specialized agents in parallel
3. **Wait** - Let all agents complete their focused tasks
4. **Synthesize** - Main agent compiles and connects findings
5. **Present** - Concise summary with file:line references

## Orchestration Examples

See `examples/` directory for full patterns:
- **create_handoff.md**: Session compaction strategy
- **research_codebase.md**: Multi-agent parallel research
- **resume_handoff.md**: Context restoration and validation

## Adaptations for MCP

These files are adapted from HumanLayer. To adapt for MCP:

1. Transform agent markdown into MCP tool definitions
2. Implement the orchestration patterns in your MCP server
3. Add MCP-specific protocol handling
4. Maintain the core compaction principles

## Core Principles

All agents follow the **Documentarian Principle**:
- Document what EXISTS, not what SHOULD BE
- No suggestions, improvements, or critique (unless explicitly asked)
- Focus on facts, not opinions
- Return only what's needed, nothing more

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.

Portions of this project are adapted from the HumanLayer project:
- Copyright (c) 2024, humanlayer Authors
- Licensed under the Apache License 2.0
- Source: https://github.com/humanlayer/humanlayer
