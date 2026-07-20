#!/usr/bin/env node
// Idempotent insert/remove of an instruction block into a host's instruction
// file (CLAUDE.md / AGENTS.md / GEMINI.md / rule files), so a host's model is
// told about something before it starts a task. Marker comments make this
// reversible — it never touches the rest of the file.
//
// This module owns the mechanism only. What the block SAYS comes from a
// connector descriptor supplied by the caller:
//
//   {
//     id:       marker id, e.g. "harness-router" -> <!-- harness-router:start -->
//     body:     the instruction text
//     bodyFor:  optional (host) => text, when one host needs different wording
//     summary:  one line, used as the description in rule-file frontmatter
//   }
//
// Keeping the text out of here is what lets a capability ship its own connector
// wording and take it away again when uninstalled.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

export function markersFor(id) {
  return { start: `<!-- ${id}:start -->`, end: `<!-- ${id}:end -->` };
}

export function wrapBlock(connector, host = null) {
  const { start, end } = markersFor(connector.id);
  const body = (host && connector.bodyFor?.(host)) || connector.body;
  return `${start}\n${body.trim()}\n${end}`;
}

export function hasBlock(targetPath, id) {
  if (!existsSync(targetPath)) return false;
  const content = readFileSync(targetPath, "utf8");
  const { start, end } = markersFor(id);
  return content.includes(start) && content.includes(end);
}

// A dedicated, harness-owned rule file carries frontmatter BEFORE the marker
// block. Cursor uses `description` + `alwaysApply`; Windsurf uses `trigger`.
function withFrontmatter(frontmatter, block) {
  return `---\n${frontmatter}\n---\n\n${block}`;
}

export function blockForVariant(variant = "generic", connector) {
  if (!connector) throw new Error("blockForVariant requires a connector descriptor");
  if (variant === "claude-code") return wrapBlock(connector, "claude-code");
  const generic = wrapBlock(connector);
  if (variant === "cursor-rule") {
    return withFrontmatter(`description: ${connector.summary}\nalwaysApply: true`, generic);
  }
  if (variant === "windsurf-rule") return withFrontmatter("trigger: always_on", generic);
  return generic;
}

export function upsertBlock(targetPath, block, { id } = {}) {
  const markerId = id ?? idFromBlock(block);
  const { start, end } = markersFor(markerId);
  const before = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : "";
  const startIdx = before.indexOf(start);
  const endIdx = before.indexOf(end);
  const after =
    startIdx !== -1 && endIdx !== -1
      ? before.slice(0, startIdx) + block + before.slice(endIdx + end.length)
      : before.length > 0
        ? `${before.trimEnd()}\n\n${block}\n`
        : `${block}\n`;
  writeFileSync(targetPath, after);
  return after !== before;
}

export function removeBlock(targetPath, { id } = {}) {
  if (!existsSync(targetPath)) return false;
  const content = readFileSync(targetPath, "utf8");
  const markerId = id ?? idFromContent(content);
  if (!markerId) return false;
  const { start, end } = markersFor(markerId);
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return false;
  const before = content.slice(0, startIdx).replace(/\n+$/, "\n");
  const after = content.slice(endIdx + end.length).replace(/^\n+/, "");
  writeFileSync(targetPath, `${before}${after}`);
  return true;
}

// Callers that already hold a rendered block (or an existing file) do not need
// to pass the id twice — it is recoverable from the marker itself.
function idFromBlock(block) {
  return /<!--\s*([\w.-]+):start\s*-->/.exec(block)?.[1] ?? null;
}

function idFromContent(content) {
  return idFromBlock(content);
}

async function main() {
  const [, , command, targetPath, variant] = process.argv;
  if (!targetPath || !["install", "remove"].includes(command)) {
    console.error(
      "usage: generate.mjs <install|remove> <path-to-CLAUDE.md-or-similar> [claude-code|generic|cursor-rule|windsurf-rule]",
    );
    process.exitCode = 1;
    return;
  }
  const { connectorsFromProviders } = await import("../../core/state/connectors.mjs");
  const connectors = await connectorsFromProviders();
  if (connectors.length === 0) {
    console.error("no capability provider supplies an instruction connector; nothing to write");
    process.exitCode = 1;
    return;
  }
  for (const connector of connectors) {
    const changed =
      command === "install"
        ? upsertBlock(targetPath, blockForVariant(variant, connector), { id: connector.id })
        : removeBlock(targetPath, { id: connector.id });
    console.log(`${command} ${connector.id} -> ${targetPath}: ${changed ? "changed" : "no-op"}`);
  }
}

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
