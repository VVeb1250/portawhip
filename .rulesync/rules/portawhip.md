---
root: true
targets: ["*"]
description: "Portawhip project agent instructions"
globs: ["**/*"]
---

<!-- harness-router:start -->
Before starting a task, call `route(task summary)` on the harness-router MCP
server and follow any returned pointers. State only the positively requested action
and its direct object; omit background, merely mentioned, rejected, or negated
candidate actions. Do not copy the raw prompt. An empty result is normal and
means nothing relevant is installed — proceed without it.
<!-- harness-router:end -->

<!-- codegraph-link:start -->
## CodeGraph (code intelligence)

This project has a CodeGraph index (`.codegraph/`). Use it for code navigation instead of a grep/Read/Explore loop.

**Code questions** (how does X work · what calls Y · impact of changing Z · find a symbol · trace a path): answer with CodeGraph MCP directly - `codegraph_explore` is the primary one-call tool (how X works, the flow of how X reaches Y, or surveying an area; returns verbatim source grouped by file + relationship map + blast radius), `codegraph_search` to find a symbol by name, `codegraph_node` for one symbol's full source, `codegraph_callers` / `codegraph_callees` / `codegraph_impact` for call flow, `codegraph_files` for the indexed file tree, `codegraph_status` for index health. A handful of calls, usually **zero file reads**; treat returned source as authoritative (already read). The index auto-syncs on save; a warning banner names any file pending sync - Read that one directly.

**Do NOT delegate code exploration to an Explore sub-agent or a grep/Read loop when CodeGraph can answer it** - that re-derives what the index already built and costs more for the same result. For code-navigation on this project, this **overrides** the general "always use Explore / parallel agents" guidance. (Sub-agents are still right for non-code research, writing, and multi-file edits.)

**Architecture / orientation & docs / papers / images:** CodeGraph is code-only and there's no graphify graph here. Build orientation from CodeGraph itself (`codegraph_files`, then `codegraph_explore` on entry points) plus direct reads for docs. Run `/graphify` then re-run `/codegraph-link` to upgrade this block to the graphify-aware split (architecture digest + multimodal doc coverage).
<!-- codegraph-link:end -->
