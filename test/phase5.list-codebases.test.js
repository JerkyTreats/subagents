import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { listCodebasesTool } from "../src/tools/list_codebases.js";

test("list_codebases finds git repos and common manifests", async () => {
  const tmpRoot = path.join(process.cwd(), ".test-tmp", "phase5-codebases");
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.mkdir(tmpRoot, { recursive: true });

  const repoA = path.join(tmpRoot, "repo-a");
  await fs.mkdir(path.join(repoA, ".git"), { recursive: true });
  await fs.writeFile(path.join(repoA, "package.json"), JSON.stringify({ name: "@acme/repo-a" }), "utf8");

  const repoB = path.join(tmpRoot, "repo-b");
  await fs.mkdir(path.join(repoB, ".git"), { recursive: true });
  await fs.writeFile(path.join(repoB, "pyproject.toml"), 'name = "repo-b"\n', "utf8");

  const config = {
    roots: [tmpRoot],
    limits: { maxFilesRead: 50, maxBytesRead: 1024 * 1024 },
    runtime: { maxConcurrentTasks: 1, defaultDeadlineMs: 1000 },
    provider: { kind: null },
    logging: { level: "error" },
  };

  const res = await listCodebasesTool.handler({
    arguments: { roots: [tmpRoot], maxDepth: 2, maxDirs: 200, maxProjects: 50 },
    config,
  });

  const payload = JSON.parse(res.content[0].text);
  assert.deepEqual(payload.rootsSearched, [tmpRoot]);

  const roots = payload.projects.map((p) => p.root).sort();
  assert.ok(roots.includes("repo-a"));
  assert.ok(roots.includes("repo-b"));

  const a = payload.projects.find((p) => p.root === "repo-a");
  assert.equal(a.git, true);
  assert.ok(a.manifests.includes("package.json"));
  assert.ok(a.tags.includes("node"));
  assert.equal(a.name, "@acme/repo-a");

  const b = payload.projects.find((p) => p.root === "repo-b");
  assert.equal(b.git, true);
  assert.ok(b.manifests.includes("pyproject.toml"));
  assert.ok(b.tags.includes("python"));
  assert.equal(b.name, "repo-b");
});

