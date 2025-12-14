---
title: "Subagent Compaction Tool (MCP Server) Spec"
status: draft
audience: engineering
last_updated: 2025-12-13
---

# Subagent Compaction Tool (MCP Server) Spec

## 1) Context and Intent

This repository contains prompt patterns and orchestration examples pulled from `/home/jerkytreats/ai/humanlayer/` (see `agents/` and `examples/`). They are **jumping-off points**, not final requirements.

We will build a **custom MCP server** (Model Context Protocol) that is installed into **LM Studio** via its plugin integration (`mcp.json`). During chat, the model will invoke MCP tools exposed by this server. Those tools will **spawn subagents in the background** whose primary goal is to **search, filter, and compact high-signal context** and return it to the model/user in a structured, low-token format.

All models are hosted locally. No external web dependency is assumed by default.

## 2) Goals and Non-Goals

### Goals
- Provide an MCP server that exposes one or more tools for “context research + compaction”.
- Spawn specialized subagents (locators/analyzers/pattern finders) to reduce main-context load.
- Return compact, high-signal outputs with **file-path / file:line references** instead of large blobs.
- Support iterative use in chat (follow-up questions, refinements).
- Work with local model hosting (LM Studio / local inference runtimes).
- Be safe-by-default (bounded reads, redaction policies, predictable resource usage).

### Non-Goals
- Writing or modifying the user’s codebase during research (design phase focuses on read-only context gathering).
- External web search as a default capability (may be optional and explicitly enabled later).
- A perfect generalized “autonomous agent” framework; this is a focused compaction tool.

## 3) Terms

- **Main agent**: The model/user-facing orchestration logic embodied by the LM Studio chat model invoking MCP tools.
- **Subagent**: A specialized worker (LLM invocation + deterministic tooling) that searches/reads/summarizes a narrow slice.
- **Compaction**: Transforming potentially large context into a small, high-signal artifact: pointers, excerpts only when essential, and decision/constraint summaries.
- **Artifact**: A persisted output (optional), e.g., a research memo or handoff document stored on disk.

## 4) Product Requirements

### 4.1 Primary User Stories
- As a developer, I can ask a question about a local codebase and receive a compact answer with file references and “where to look next”.
- As a developer, I can request “find where X is implemented” and get organized paths without long excerpts.
- As a developer, I can request “show existing patterns for Y” and get a few grounded examples with minimal snippets.
- As a developer, I can resume work by asking the tool to produce a compact handoff / status summary (optional artifact).

### 4.2 Core Capabilities
- **Search**: fast keyword search (ripgrep-like), filename globbing, directory listing.
- **Read**: bounded file reading with safeguards (size limits, binary detection, path allowlists).
- **Parallelism**: run multiple subagent tasks concurrently and merge results.
- **Synthesis**: produce an aggregated, compact report with prioritization and references.
- **Optional artifact generation**: write a research memo / handoff file (explicitly requested).

### 4.3 Output Quality Bar (Compaction Contract)
All outputs should:
- Prefer **references over inclusion** (paths, file:line, “section headings”).
- Include **only** information that helps answer the user query or informs the next step.
- Be explicit about uncertainty (“not found”, “only saw X in these locations”).
- Avoid “recommendations” unless the user asked for them; default to describing what exists.
- Fit within a configurable token budget (server-side target size).

## 5) System Architecture (High-Level)

### 5.1 Components
1. **MCP Server**
   - Exposes tools (e.g., `ping`, `list_roots`, `research_codebase`, later: `locate_in_codebase`, `analyze_component`, `find_patterns`, `create_handoff`).
   - Owns configuration, path policies, concurrency, and response shaping.

2. **Subagent Runtime**
   - A scheduler that executes subagent tasks (prompt + tool permissions + budgets).
   - Collects results, enforces timeouts, and returns normalized summaries.

3. **Tooling Layer**
   - Deterministic utilities: grep, glob, ls, read, (optional) structured file indexing.
   - Must be sandboxed to user-approved roots.

4. **Local Model Provider**
   - LM Studio local model endpoint(s) or other local inference runtimes.
   - Must support multiple simultaneous calls or queued execution.

### 5.2 Hosting/Execution (Local-Only)
This spec uses a **Worker Pool** hosting model:
- The MCP server manages a fixed-size pool of workers that execute subagent tasks.
- The pool enforces predictable concurrency, timeouts, and cancellation without unbounded fan-out.
- The server owns scheduling, per-task budgets, and aggregation/synthesis of results.

## 6) MCP Interface Requirements

### 6.1 LM Studio Integration
- The MCP server must be discoverable/configurable via LM Studio’s plugin integration (`mcp.json`).
- The tools should be named and described for chat usability (clear, concise tool descriptions).
- Tool inputs must be JSON-schema-like (or MCP equivalent): explicit required/optional fields, sane defaults.

### 6.2 Tool Surface (Initial)
Bootstrap tools:
- `ping`
  - Input: none
  - Output: `"pong"`
- `list_roots`
  - Input: none
  - Output: allowlisted workspace roots

Minimum viable research tool:
- `research_codebase`
  - Input: `question`, optional `roots`, optional `constraints` (time/token budgets), optional `artifact` toggle.
  - Output: compact report + references, optional artifact path.

Recommended supporting tools (may be internal-only first, then exposed):
- `locate_in_codebase`
  - Output: categorized paths and brief notes (“where”).
- `find_patterns`
  - Output: 2–6 example references + small essential snippets (“how it’s done elsewhere”).
- `analyze_component`
  - Output: traced flow notes with references (“how it works”).

Optional later:
- `resume_handoff` / `create_handoff` (artifact management workflow).
- `web_research` (explicit opt-in, gated behind network permission).

### 6.3 Schemas and Contracts (Normative)
This section defines the **minimum stable schemas** that subagents and synthesizers must produce.

#### Reference Format
References should be emitted as strings in one of these formats:
- `path/to/file.ext`
- `path/to/file.ext:line`
- `path/to/file.ext:line:col`

#### Normalized Subagent Result Schema
Every subagent returns a payload shaped like:
```json
{
  "summary": "string",
  "references": ["path/to/file.ext:123"],
  "key_findings": ["string"],
  "confidence": "low|med|high",
  "notes": "string|null"
}
```

#### Runtime Wrapper Schema
The runtime wraps all subagent results (and failures) into:
```json
{
  "status": "ok|timeout|canceled|error",
  "value": { "summary": "string", "references": [], "key_findings": [], "confidence": "low", "notes": null },
  "error": { "name": "Error", "message": "string" },
  "timing": { "startedAt": 0, "elapsedMs": 0 }
}
```
Rules:
- `value` is present only when `status: "ok"`.
- `error` is present only when `status !== "ok"`.

#### `research_codebase` Output Contract
`research_codebase` returns a compact, machine-readable report (as JSON text in MCP `content`):
```json
{
  "question": "string",
  "rootsSearched": ["/abs/path/root"],
  "locator": {
    "status": "ok|timeout|canceled|error",
    "value": { "summary": "string", "references": [], "key_findings": [], "confidence": "low", "notes": null },
    "error": { "name": "Error", "message": "string" },
    "timing": { "startedAt": 0, "elapsedMs": 0 }
  }
}
```
As more roles are added (analyzer/pattern-finder), this report grows by adding new top-level role keys (e.g., `analyzer`, `patterns`) using the same runtime wrapper schema.

## 7) Subagent Design Requirements

### 7.1 Subagent Roles (Derived from `agents/`)
We will model initial roles after `agents/`:
- Locator: “where does X live” (paths only; minimal content).
- Analyzer: “how does X work” (reads selectively; file:line evidence).
- Pattern Finder: “show existing similar examples” (small snippets + references).
- Thoughts Locator/Analyzer: “what historical docs exist” (only if a `thoughts/` root is configured).

Role prompts should remain short and stable; behavior is enforced by:
- tool permissioning (read-only),
- strict output schemas,
- post-processing (length limits, required references).

### 7.2 Permissions and Budgets
Each subagent must have:
- Allowed roots (e.g., repo root, optional thoughts root).
- Allowed tools (Grep/Glob/LS/Read; optional others).
- Hard limits: max files read, max bytes read, max time, max concurrent tasks.
- Redaction rules (see §9).

Default Phase 2+ budgets (configurable):
- `limits.maxFilesRead`: 50
- `limits.maxBytesRead`: 1_048_576 (1 MiB)
- `runtime.defaultDeadlineMs`: 30_000
- `runtime.maxConcurrentTasks`: 4

### 7.3 Result Normalization
Each subagent returns a structured payload:
- `summary` (short),
- `references` (paths + optional line numbers),
- `key_findings` (bulleted, bounded),
- `confidence` (low/med/high),
- `notes` (optional, bounded).

The MCP server synthesizer merges these into a single report.

### 7.4 Role Library (Normative)
Role definitions are intentionally short. Deterministic tooling and schema enforcement provide the guardrails.

**Locator**
- Purpose: map *where* relevant code/docs likely live.
- Output: references only; no long excerpts.
- Tools: search/list; no writes.

**Analyzer**
- Purpose: explain *how* something works with evidence.
- Output: short flow notes + file:line references; minimal snippets only when required.
- Tools: search + bounded reads; no writes.

**Pattern Finder**
- Purpose: show 2–6 representative examples of an existing pattern.
- Output: references + small essential snippets; avoid duplication.
- Tools: search + bounded reads; no writes.

## 8) Compaction Workflow (End-to-End)

### 8.1 Default Workflow for `research_codebase`
1. **Clarify scope** (if missing): identify root(s), target component(s), keywords.
2. **Spawn locators first** to map the territory (paths, entry points).
3. **Spawn targeted analyzers** on the most relevant files/areas.
4. **Spawn pattern finder** if the query requests examples or similar implementations.
5. **Wait for all subagents** (or until a deadline) and collect results.
6. **Synthesize**:
   - Answer the question directly.
   - Provide “where to look” references.
   - Include minimal snippets only when they materially improve comprehension.
7. **Optionally persist artifact** (if requested): a markdown memo with the same compact structure.

### 8.2 Compaction Heuristics
Priority ordering:
1. Direct answers with evidence.
2. Entry points and call paths.
3. High-signal config/constants.
4. Existing patterns/examples.
5. Historical notes (only when configured and relevant).

Avoid:
- Large diffs or full-file dumps.
- Repeating the same reference across agents; dedupe in synthesis.

### 8.3 Artifact Format (Optional)
Artifacts are persisted only on explicit request (e.g., `artifact: true`). They should mirror the compact, referenced report structure used in tool responses.

Minimum artifact format (markdown):
- Title line: `# Research Handoff`
- `## Question` (verbatim user question)
- `## Summary` (2–6 sentences, no recommendations by default)
- `## Key Findings` (bullets; bounded)
- `## References` (paths and `path:line` entries; deduped)
- `## Constraints / Budgets` (roots searched, limits used, timeouts)
- `## Notes` (optional; bounded)

Artifacts must follow the same redaction rules as tool outputs (§9.2).

## 9) Safety, Privacy, and Policy

### 9.1 File Access Controls
- Default allowlist: only within configured workspace roots.
- Denylist: secrets directories (configurable), OS/system paths, large binaries.
- Binary detection and max-size cutoffs.

### 9.2 Secret Handling
- Detect likely secrets (tokens/keys) and redact in outputs.
- Never include environment variables or credentials in artifacts.

Minimum redaction requirements:
- Redact long token-like strings (API keys, bearer tokens, JWTs) even if they appear in source files.
- Redact credentials in URLs (e.g., `https://user:pass@host/...`).
- When redaction happens, preserve surrounding context by leaving references intact (prefer `path:line` over including the secret).

### 9.3 Network Controls
- Default: no external network.
- If web research is added, it must be explicit opt-in and respect sandbox/network policy.

## 10) Observability and UX

### 10.1 Progress Reporting
Tool responses should optionally include:
- spawned task count,
- which roles ran,
- elapsed time and any timeouts,
- what was searched (keywords) at a high level (not leaking sensitive content).

### 10.2 Determinism and Reproducibility
- Report the roots searched and constraints used.
- Prefer stable ordering of results.
- Include “not found” when applicable.

## 11) Development Phases

Each phase is represented as a table of atomic tasks.

### Phase 1: Bootstrap MCP Server
| Task | Output | Done When | TODO |
|---|---|---|---|
| Implement MCP server skeleton | Tool registration + request/response plumbing | Server starts and responds to basic calls | - [x] |
| Validate LM Studio integration | Working `mcp.json` plugin configuration | LM Studio can invoke `ping` / `list_roots` reliably | - [ ] |
| Implement configuration system | Roots, limits, logging level | Config loads and is applied to tool execution | - [x] |
| Add Phase 1 tests (unit) | Automated checks for config + tool routing | Test run proves “tools/list + tools/call” behave as expected | - [x] |

#### Unit Tests (Phase 1)
- Server boots with minimal config and registers expected tool names.
- Tool input validation: missing required fields returns a structured error.
- `list_roots` returns only configured roots and never leaks non-allowlisted paths.
- Config parsing/merging: defaults apply, overrides work, invalid values are rejected.
- Logging level/config: changes behavior without affecting tool outputs.

### Phase 2: Implement Subagent Call
| Task | Output | Done When | TODO |
|---|---|---|---|
| Build subagent runtime abstraction | Task definition + scheduling + cancellation/timeouts | Runtime runs tasks with enforced deadlines | - [x] |
| Implement Locator subagent | Single-role Locator wired to deterministic tools | Locator returns structured results with references | - [x] |
| Integrate local model provider for subagents | Provider client supporting queued or concurrent execution | Multiple subagent calls execute under worker-pool limits | - [x] |
| Wire `research_codebase` to Locator | End-to-end tool path using the runtime | `research_codebase` runs Locator and returns structured output | - [x] |
| Add Phase 2 tests (runtime + integration) | Tests for deadlines/cancellation + worker pool limits + `research_codebase`→Locator path | Tests cover timeouts, cancellation, and bounded concurrency | - [x] |

#### Unit Tests (Phase 2)
- Worker pool enforces `max_concurrent_tasks` and queues or rejects predictably when saturated.
- Deadlines: task exceeding `deadline_ms` is canceled and reported as timed out (no partial schema breakage).
- Cancellation: explicitly canceled tasks stop further tool execution and return a canceled status.
- Error mapping: provider/tool failures surface as structured errors with stable codes.
- Locator output schema: `summary`, `references`, `key_findings`, `confidence` present and bounded.
- Locator evidence: references are deduped and stable-ordered; no large excerpts by default.
- `research_codebase` orchestration: runs Locator first and propagates constraints/roots correctly.

### Phase 3: Design Compaction Workflow
| Task | Output | Done When | TODO |
|---|---|---|---|
| Define role library | Locator/Analyzer/Pattern Finder role definitions based on `agents/` | Roles are documented with clear inputs/outputs | - [x] |
| Define synthesis contract + schemas | Output schemas for subagents and synthesized report | Schemas are explicit and reviewable by the team | - [x] |
| Define heuristics, budgets, and redaction | Compaction rules + limits + safety policy | Budgets and redaction rules are unambiguous | - [x] |
| Define artifact format (optional) | Research/handoff memo structure | Artifact format is specified (or explicitly deferred) | - [x] |
| Align on tool surface and constraints | Reviewed tool names + schemas + safety constraints | Team agreement recorded | - [x] |
| Define Phase 3 acceptance tests (goldens) | Scenario list + expected “compact output” characteristics + schema fixtures | Acceptance tests are documented and implementable | - [x] |

#### Unit Tests (Phase 3)
- Schema validation tests: every tool response conforms to the agreed JSON schema (no extra/missing fields).
- Synthesizer ordering determinism: same inputs produce stable ordering and stable deduplication.
- Compaction budget tests: outputs stay within limits (max bullets/snippets/bytes) and truncate with explicit notes.
- Redaction tests: known secret patterns are removed from outputs and artifacts while preserving references.
- Reference formatting tests: file references are emitted as `path:line` (when available) and never as full dumps.
- Golden/acceptance fixtures: representative prompts map to expected “high-signal, low-token” outputs.

#### Acceptance Tests (Phase 3)
These scenarios define “golden” expectations for compaction quality (not implementation details).

- **Locate-only**: question “Where is X implemented?”
  - Expects: `locator.status: ok`, `references.length > 0`, no large excerpts, stable ordering.
- **Not found**: question about a non-existent symbol
  - Expects: `references.length == 0`, explicit “not found” phrasing in `summary`, `confidence: low`.
- **Scope restriction**: provide `roots` that exclude the relevant file
  - Expects: report shows `rootsSearched` accurately and does not leak paths outside them.
- **Budget pressure**: set small byte/file limits
  - Expects: bounded outputs + explicit note in `summary`/`notes` that limits may have truncated results.
- **Redaction**: repository contains a fake token string
  - Expects: outputs do not include the raw token; references remain.

### Phase 4: Implement Compaction Workflow
| Task | Output | Done When | TODO |
|---|---|---|---|
| Implement full `research_codebase` pipeline | locate → analyze → pattern-find → synthesize | Pipeline runs end-to-end under budget limits | - [x] |
| Implement concurrency + dedupe | Worker-pool scheduling + result deduplication | Concurrency is bounded and outputs are stable | - [x] |
| Add caching/indexing (optional) | Cache or index implementation | Enabled only if configured and measurably helps | - [ ] |
| Implement artifact writing (optional) | Markdown memo persisted on explicit request | Artifact path returned and content matches compaction contract | - [x] |
| Add Phase 4 tests (regression + E2E) | Tests for redaction, bounds enforcement, schema stability, and end-to-end `research_codebase` runs | Tests pass and prevent regressions | - [x] |
| Validate across representative repos | Smoke runs on 3–5 repos | Outputs are consistently compact and high-signal | - [ ] |

#### Unit Tests (Phase 4)
- Pipeline orchestrator: given mocked role results (locate/analyze/pattern-find), synthesis returns a compact report with stable ordering.
- Partial-results behavior: when a role times out/errors, synthesis still returns a valid report and records the missing/partial role.
- Budget enforcement: max files/bytes/time/concurrency are respected across the whole pipeline (not per-role only).
- Dedupe correctness: identical references from multiple roles are merged without losing role-specific findings.
- Artifact writing: artifacts are only written when requested, are redacted, and the output path is within configured artifact root.
- Caching/indexing (if enabled): cache keying is stable, bypass works, and cache hits do not change semantic results.

## 12) Open Design Decisions (To Resolve Early)
- Worker pool sizing strategy and per-request concurrency caps.
- Worker implementation details (including isolation expectations).
- Local model routing: one model for all roles vs per-role model selection.
- Artifact persistence: where to store research/handoff outputs in this repo vs external “thoughts/” tree.
- Caching/indexing: ripgrep-on-demand only vs building an index for large repos.
- Schema strictness: freeform markdown vs JSON + markdown sections.

## 13) References in This Repo
- Agent role examples: `agents/codebase-locator.md`, `agents/codebase-analyzer.md`, `agents/codebase-pattern-finder.md`, `agents/thoughts-locator.md`, `agents/thoughts-analyzer.md`
- Orchestration examples: `examples/research_codebase.md`, `examples/create_handoff.md`, `examples/resume_handoff.md`
