import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  canonicalSurfaceEntries,
  collectSurfaceLinks,
  isManaged,
  isSourceDir,
  withMarker,
} from "./link-surfaces.mjs";

test("canonicalSurfaceEntries: only command/agent with a path, deduped", () => {
  const out = canonicalSurfaceEntries([
    { id: "a", type: "command", path: "/x/a.md" },
    { id: "a", type: "command", path: "/y/a.md" }, // dup id -> first wins
    { id: "b", type: "agent", path: "/x/b.md" },
    { id: "c", type: "cli" }, // wrong type
    { id: "d", type: "command" }, // no path
  ]);
  assert.deepEqual(out.map((e) => e.id), ["a", "b"]);
  assert.equal(out[0].path, "/x/a.md");
});

test("isSourceDir: a file under the target dir is its own source", () => {
  assert.equal(isSourceDir("/home/.claude/commands/a.md", "/home/.claude/commands"), true);
  assert.equal(isSourceDir("/home/.codex/prompts/a.md", "/home/.claude/commands"), false);
});

test("withMarker/isManaged: injects after frontmatter, idempotent", () => {
  const md = "---\nname: a\n---\n# body\n";
  const marked = withMarker(md, "a");
  assert.ok(isManaged(marked));
  assert.match(marked, /---\r?\n<!-- portawhip-managed: a -->/);
  assert.equal(withMarker(marked, "a"), marked, "second pass is a no-op");
  assert.ok(!isManaged(md));
});

test("withMarker: prepends when there is no frontmatter", () => {
  const marked = withMarker("# just a heading\n", "x");
  assert.match(marked, /^<!-- portawhip-managed: x -->/);
});

test("surface linker is inventory-only; Rulesync owns command and agent writes", () => {
  const dir = mkdtempSync(join(tmpdir(), "link-surfaces-"));
  const srcDir = join(dir, "src");
  const destDir = join(dir, "codex", "agents");
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, "reviewer.md"), "---\nname: reviewer\n---\n# reviewer\n");

  const entries = [{ id: "reviewer", type: "agent", path: join(srcDir, "reviewer.md") }];
  const targets = {
    "claude-code": { agent: [{ scope: "global", dir: srcDir, format: "md" }] }, // source host
    codex: { agent: [{ scope: "global", dir: destDir, format: "md" }] },
    "gemini-cli": { agent: [{ scope: "global", format: "unknown", unsupported: true }] },
  };

  const status = collectSurfaceLinks({ command: "status", scope: "global", entries, targets });
  const byHost = Object.fromEntries(status.rows.map((r) => [r.hostId, r.status]));
  assert.equal(byHost["claude-code"], "source", "source host is not a copy target");
  assert.equal(byHost.codex, "missing");
  assert.equal(byHost["gemini-cli"], "unsupported");

  assert.throws(
    () => collectSurfaceLinks({ command: "install", scope: "global", entries, targets }),
    /inventory-only.*Rulesync/i,
  );
  assert.throws(
    () => collectSurfaceLinks({ command: "remove", scope: "global", entries, targets }),
    /inventory-only.*Rulesync/i,
  );
});
