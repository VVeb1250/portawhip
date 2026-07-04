# Plan: Smart Capability Router (portable-harness-v2, Step 2+)

> Executor: Claude Sonnet. Work through phases in order. Each phase has explicit
> **Verify** and **Exit criteria** — do not start the next phase until the current
> one passes. Ask the user only when a decision gate says so.

## 1. Context

Step 1 (done, in this repo): declarative `recipe.yaml` + `scripts/load.mjs`
dispatches capability installation to existing backends (add-mcp / mise / asm)
across detected hosts. See `scripts/load.mjs`, `scripts/hosts.mjs`,
`scripts/doctor.mjs`.

**Problem this plan solves:** capabilities that are merely *installed and listed
in context* get ignored by the model (attention dilution, lost-in-the-middle,
no trigger at the decision point). Evidence: sessions with ~300 skills listed
where only hook-suggested skills get used — and the old local skill-router hook
itself misfires (suggested `homelab-pihole-dns` for a router-design question)
because it always emits top-3 with no abstain threshold.

**Goal:** a router that injects/exposes the *right* capability at the *right
time*, across as many AI hosts as possible, from the same `recipe.yaml` that
already drives installation.

## 2. Landscape constraints (researched 2026-07-04 — do not rebuild these)

Crowded, must NOT reimplement:
- MCP aggregation/gateway + semantic tool gating: igrigorik/MCProxy,
  ajbmachon/tool-gating-mcp, Dumbris/mcpproxy, metatool-ai/metamcp,
  microsoft/mcp-gateway.
- Skill routing per se: github.com/topics/skill-router (~10 repos; SkillPilot
  has a feedback loop; Universal AI Skills Library does on-demand loading of
  1,800+ skills multi-agent).
- Cross-host config sync/loader: amtiYo/agents, wshobson/agents, affaan-m/ecc.

Open gaps we target (our differentiators):
1. **Unified routing across ALL capability types** — MCP tools + skills + docs/
   conventions + memory through one brain (existing projects do one type each).
2. **Loader + router driven by one recipe** — same entry declares install AND
   routing metadata.
3. **Push + pull dual mode from one core** — MCP tool (pull, portable) plus
   host hooks (push) sharing the same scorer.
4. **State-aware timing** — inject on pre/post tool events, not just on prompt
   (later phase).

## 3. Design principles (binding)

- **Default = silent.** Router emits nothing below a high confidence threshold.
  Precision over recall; recall is covered by the pull-mode escape hatch
  (`route()` / `list_all()`).
- **Token budget.** Push injections capped (default ≤ 300 tokens per prompt,
  configurable). Hints (1 line + pointer) over full content.
- **One core, thin adapters.** All scoring/registry logic lives in `core/`.
  A host adapter is ≤ ~50 lines of glue that shells into the same CLI/core.
- **Don't route what the host already routes.** Claude Code defers MCP tools
  natively (ToolSearch); router adds value there mainly for skills/docs/memory.
  On hosts without deferral (Codex, Gemini CLI, Cursor…), the gateway path
  carries tools too.
- **recipe.yaml is the single source of truth.** No second registry file.
- **No hardcoding hosts.** Host detection stays in `hosts.mjs`-style probing;
  adapters are data-driven where possible.

## 4. Target architecture

```
recipe.yaml                  # single source of truth (install + route metadata)
scripts/load.mjs             # step-1 loader (exists; extend, don't rewrite)
core/
  registry.mjs               # parse recipe + route metadata → normalized index
  capability-docs.mjs        # compact retrievable documents per capability
  sparse-retriever.mjs       # lexical retrieval over capability docs
  fusion.mjs                 # rank fusion (RRF) across retrieval channels
  hybrid-router.mjs          # conservative hybrid retrieval → ABSTAIN
  scorer.mjs                 # Phase-1 keyword scorer kept as a baseline/fallback
  feedback.mjs               # append-only JSONL log: suggested → used?
  router-cli.mjs             # `router route --prompt "..."` (adapters call this)
server/
  mcp-server.mjs             # pull mode: MCP server exposing route/list/use
adapters/
  claude-code/               # push: UserPromptSubmit hook (thin shim)
  opencode/                  # push: JS plugin (thin shim)
  instructions/              # per-host one-liner blocks for CLAUDE.md/AGENTS.md/
                             # GEMINI.md pointing the model at route()
```

### recipe.yaml schema extension

```yaml
- id: anthropic-skills
  type: skill
  source: github:anthropics/skills
  path: skills/pdf
  route:                      # NEW, optional block
    triggers: ["pdf", "merge pages", "ocr", "extract table"]
    description: "Read/merge/split/OCR PDF files"   # for semantic layer
    when: [user_prompt]       # later: pre_tool, post_tool
    inject: hint              # hint | full
```

Entries without `route:` are still installable but never pushed — only
discoverable via `list_all()`.

### MCP tool contract (pull mode)

- `route(query: string, k?: number)` → top-k matches above threshold:
  `{ id, type, score, how_to_use, pointer }` where `pointer` is a file path
  (skills/docs), tool name (MCP), or command (CLI). Empty array is a valid,
  expected result.
- `list_all(type?: string)` → compact catalog (id + one-line description).
- `use(id, tool, args)` → passthrough to a downstream MCP server IF we adopt a
  gateway base (Phase 0 decision); otherwise omit in v1.

## 5. Phases

### Phase 0 — Audit & base decision (no code in repo yet)

Audit these repos (clone or read on GitHub; check actual code, not README
claims): `Dumbris/mcpproxy`, `metatool-ai/metamcp`, `igrigorik/MCProxy`,
`ajbmachon/tool-gating-mcp`, `RealTapeL/SkillPilot`.

For each record: language/runtime, stdio-MCP support, dynamic tool exposure
(`tools/list_changed`), embeddability as library vs standalone process, license,
maintenance signal (last commit, issues), Windows support.

**Decision gate (ask user with findings):**
- A) Embed/wrap one gateway as the `use()`/aggregation layer, we build only
  routing core + adapters on top. Preferred if a candidate is embeddable,
  maintained, Windows-clean.
- B) v1 skips tool aggregation entirely: router returns *pointers* only
  (no passthrough), hosts keep their direct MCP connections. Simplest;
  aggregation added later. Choose this if all candidates are heavyweight.

**Exit criteria:** one-page comparison table written to `docs/phase0-audit.md`;
user picked A or B.

### Phase 1 — Registry + scorer core (pure functions, no server)

1. Extend recipe parsing: `core/registry.mjs` reads `recipe.yaml`, validates
   `route:` blocks (fail loud on malformed), emits normalized index (plain JSON,
   cached at `.hp-state/route-index.json`).
2. `core/scorer.mjs` layer 1 only: normalized keyword/trigger matching
   (word-boundary, case-insensitive, multi-word phrase support). Score =
   weighted trigger hits. **Abstain**: return `[]` if best score < threshold
   (config in recipe header or `router.config.yaml`).
3. `core/router-cli.mjs`: `node core/router-cli.mjs route --prompt "..."`
   → JSON to stdout. Also `list --type skill`.
4. Unit tests (node:test): trigger hit, phrase hit, abstain on unrelated prompt,
   malformed route block rejected, budget respected.

**Verify:** `npm test` green; manual: router-cli on 5 sample prompts — at least
one unrelated prompt (e.g. "design a database schema") must return `[]`.
**Exit criteria:** abstain works; zero false suggestion on the unrelated set.

### Phase 2 — Pull mode: MCP server (portability proof)

1. `server/mcp-server.mjs` — stdio MCP server (use `@modelcontextprotocol/sdk`)
   exposing `route` + `list_all` (+ `use` only if Phase 0 chose A).
2. Register it on hosts via the existing step-1 loader path (add itself as a
   `type: mcp` entry in recipe — dogfood).
3. `adapters/instructions/` — generate the one-liner block per host file
   (CLAUDE.md / AGENTS.md / GEMINI.md): "Before starting a task, call
   `route(task summary)` on the harness-router MCP server; follow returned
   pointers." Idempotent insert/remove (marker comments).

**Verify:** live test on TWO hosts minimum — Claude Code and Codex CLI:
fresh session, prompt that matches a recipe trigger, confirm the model calls
`route()` and follows the pointer. Record transcript evidence in
`docs/phase2-verify.md`.
**Exit criteria:** both hosts route successfully with zero host-specific code
beyond the instruction one-liner.

### Phase 2.5 — Hybrid capability retrieval (before push)

Rationale: Phase 2 proved pull-mode behavior, but push hooks need higher
precision than the Phase-1 keyword scorer can provide. Per
`docs/router-research.md`, capability routing should be treated as tool
retrieval: retrieve compact capability documents, fuse sparse/dense signals,
then abstain unless confidence is high.

1. Add an eval set (`docs/router-eval-set.jsonl`) covering:
   - Phase-2 positive prompts (pdf, grep, SDK docs, postgres, migrations).
   - Phase-2 negative prompts.
   - hard negatives from the old noisy-hook failure mode.
2. Fix live discovery reliability so CLI and MCP see the same installed
   capabilities. Discovery failures must be observable, not silently mistaken
   for "no skills installed."
3. Build compact capability documents from registry entries:
   id/type/origin/pointer/description/triggers/source/path. Do not inline full
   skill bodies into route output.
4. Add sparse lexical retrieval over capability documents. Exact ids, command
   names, and multi-word phrases must be preserved.
5. Add rank fusion (RRF) so sparse retrieval can later combine with optional
   dense embeddings without score-scale coupling.
6. Add a small graph-expansion interface but keep it bounded: graph neighbors
   may boost/expand seeded candidates, never create a match from no seed.
7. Add `router-cli eval` and a report format with precision@1, recall@3, MRR,
   abstain accuracy, and false-positive count.

**Verify:** eval command runs locally; curated `context7`, `ripgrep`, and
`anthropic-skills` do not regress; Phase-2 positives route at rank 1 where the
capability exists; Phase-2 negatives and old noisy-hook prompts abstain.
**Exit criteria:** documented eval result in `docs/phase2.5-verify.md`; no push
adapter work starts until the eval meets the pass bar.

**Status 2026-07-04:** complete. Hybrid routing is the configured default,
keyword routing remains available via `--engine keyword`, the eval set covers
12 positives and 18 negatives, `npm run route:compare` shows hybrid meeting the
pass bar while keyword does not, and `npm run route:graph` compiles the local
capability graph used by the router.

### Phase 3 — Push mode: first adapters

1. `adapters/claude-code/`: UserPromptSubmit hook script that calls router-cli;
   on match above threshold, emit ≤ budget tokens: `capability id — one-line
   how-to — pointer`. On abstain emit NOTHING (empty stdout).
   This REPLACES the user's old broken skill-router hook — coordinate: the
   installer must detect and offer to disable the old hook (ask user before
   touching their settings).
2. `adapters/opencode/`: equivalent JS plugin if OpenCode is installed on this
   machine; otherwise stub + docs.
3. Loader integration: `load.mjs` gains `type: adapter` or a `--with-push` flag
   installing hooks per detected host.

**Verify:** in Claude Code — 10-prompt manual eval sheet (5 should-match,
5 should-abstain); require ≥ 4/5 correct suggestions and 5/5 silent abstains
(silence is the hard requirement).
**Exit criteria:** old hook disabled (with user consent), new hook meets eval.

### Phase 4 — Feedback loop + semantic layer

1. `core/feedback.mjs`: log every suggestion (JSONL in `.hp-state/feedback/`);
   Claude Code PostToolUse/Stop hook marks whether the suggested pointer was
   actually read/called within the session → `used: true|false`.
2. Weight adjustment: per-capability boost/decay from usage stats applied in
   scorer (bounded, e.g. ×0.5–×2.0).
3. Optional dense embeddings: local model via `fastembed`, BGE-M3, or similar
   pure-local option; dense retrieval is an additional Phase-2.5 channel, still
   fused and thresholded, and must degrade gracefully when absent.

**Verify:** feedback JSONL populates during a real session; a capability
ignored 5× in a row visibly drops rank in `router-cli route` output.
**Exit criteria:** end-to-end demo documented in `docs/phase4-verify.md`.

## 6. Out of scope (v1)

- Rebuilding installation logic (step 1 owns it).
- LLM-call-per-prompt classification (cost/latency; revisit only after Phase 4
  data shows keyword+embedding insufficient).
- State-aware PreToolUse/PostToolUse *injection* (only feedback marking uses
  those hooks in v1) — design doc allowed, implementation later.
- Windows-only assumptions: everything must run via Node on win32/macOS/Linux;
  shell scripts POSIX-safe or dual-provided.

## 7. Open questions already answered by user (do not re-ask)

- Cross-host is mandatory; support max hosts/OS without excessive hardcoding.
- Language/stack: anything reasonable; multi-language OK; interop is the bar.
- Old local skill-router hook is legacy/broken — replace it, don't extend it.
- Rebuild from scratch preferred over patching the old messy router.
