#!/usr/bin/env node
// View the embedded-hook inventory (Phase S3, mode B). Read-only: lists hooks
// bundled inside installed skills/plugins so a human can see what runs on
// lifecycle events. Does NOT link or execute anything.

import { discoverEmbeddedHooks, summarizeEmbeddedHooks } from "../core/discover-hooks.mjs";

function main() {
  const json = process.argv.includes("--json");
  const entries = discoverEmbeddedHooks();
  const summary = summarizeEmbeddedHooks(entries);
  if (json) {
    console.log(JSON.stringify({ summary, entries }, null, 2));
    return;
  }
  console.log(`embedded hooks: ${summary.total} (active ${summary.active}, templates ${summary.templates})`);
  console.log(`by host: ${JSON.stringify(summary.byHost)}`);
  console.log(`by package: ${JSON.stringify(summary.byPackage)}`);
  console.log("\n(inventory only — these are NOT linked; run each package's own installer to activate)\n");
  for (const e of entries) {
    const tag = e.template ? " [template]" : "";
    console.log(`${e.host} · ${e.package} · ${e.event}${e.matcher ? `/${e.matcher}` : ""}${tag}`);
    console.log(`   ${e.commandPreview}`);
  }
}

main();
