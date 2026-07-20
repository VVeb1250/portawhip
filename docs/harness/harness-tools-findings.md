# Harness Tools — token/quality/gap candidates (tested 2026-07-13)

Live evaluation of candidate harness tools for the bundle, against the goals
"reduce tokens / add quality / plug gaps." Same discipline as the writer
consolidation: measure before adopting; every adopted tool needs a `route:`
block and a proven gap. Foundry (default) vs special (opt-in) framework at the
bottom.

## repomix — token reduction (STRONG, verified)

`npx repomix core --compress --token-count-encoding o200k_base`:

| pack of `core/` (54 files) | tokens |
|---|---|
| full | 66,100 |
| `--compress` (tree-sitter signatures, bodies dropped) | 18,659 |

**−72% tokens.** Real win for the "hand the agent a repo map / signatures"
capability. **Foundry-eligible IF route-gated** (loaded only when packing a
repo, not always-on). Complements/replaces `code2prompt`.

## difftastic — situational, NOT a universal token reducer (honest)

`difft --color never` vs `git diff`, chars→~tokens:

| change type | git diff | difftastic | winner |
|---|---|---|---|
| pure reformat / whitespace | ~108 tok | ~55 tok | difft (−50%) |
| small real logic change (`>=`→`>`) | ~92 tok | ~135 tok | git diff (difft's side-by-side is wider) |

difftastic wins only on **formatting/refactor-noise diffs**; its two-column
layout is *bigger* on small real changes. It is a **quality tool** (structural
diff clarity), not a token reducer. → **special (review/refactor role)**, not a
default token play. (Installed on the dev box via scoop for this test; if adopted
it must go through mise/recipe, not manual scoop — see [[dynamic-cross-os-fixes]].)

## context-mode (mksglu/context-mode) — overlaps Portawhip structurally; opt-in only

npm `context-mode@1.0.169`, **Elastic-2.0 license** (not OSI). MCP server: 6
sandbox tools (`ctx_execute`, `ctx_execute_file`, `ctx_batch_execute`,
`ctx_index`, `ctx_search`, `ctx_fetch_and_index`) + meta tools. Sandboxes raw
tool output (claims 315 KB→5.4 KB), FTS5/BM25 knowledge base, session continuity
across compaction. Has a `postinstall` script.

**What it impacts (static-inspected from its shipped config manifests):** it
registers hooks on **six events** across every host — `PreToolUse` (broad
matcher: `Bash|Shell|Edit|Write|grep_files|ctx_*|mcp__`), `PostToolUse`,
`SessionStart`, `PreCompact`, `UserPromptSubmit`, `Stop` — and writes
`hooks.json`/`mcp.json`/`plugin.json` into each host's config dir.

**Event-slot overlap vs function overlap — measured distinction.** context-mode
registers on 4 of the same events as Portawhip's 3 hooks (route-on-prompt =
UserPromptSubmit, mark-tool-feedback = PostToolUse, auto-sync-on-start =
SessionStart; Portawhip has NO PreToolUse hook). But per each tool's own docs the
**functions differ**, so they coexist rather than crash:

| event | Portawhip's job | context-mode's job | function overlap |
|---|---|---|---|
| SessionStart | fan-out config sync (background, no context injection) | inject routing instructions + restore state (injects context) | different — coexist |
| UserPromptSubmit | suggest capabilities (injects hint) | capture user decisions to SQLite (no injection) | different — coexist |
| PostToolUse | feedback: was a suggestion used (router weighting) | capture file/task/git/error events (continuity) | different — coexist |
| PreToolUse | none | intercept `mcp__`/Bash → sandbox | no overlap; just wraps the call |

So the earlier "double injection / collision" framing was event-slot level, not
function level — corrected. The **real** residual concerns are not a runtime
conflict:
1. **Additive token tax** — context-mode injects at SessionStart, Portawhip at
   UserPromptSubmit; both add context (stacking, not colliding).
2. **PreToolUse wrapping** — context-mode's `mcp__` matcher wraps Portawhip's
   `route()` call; `route()` isn't data-heavy so its handler likely passes it
   through, but that needs a live test to confirm no nudge/latency.
3. ~~Mission overlap / redundancy~~ — **CORRECTED: they optimize orthogonal
   axes, so they are COMPLEMENTARY, not redundant** (tested below).
It also writes the same host `hooks.json`/`mcp.json` that rulesync now owns — a
writer-ownership overlap that is separate from the hook-function question.

**Axis test (2026-07-13) — orthogonal optimizers, complementary not redundant.**
`context-mode index docs/` then `search` (isolated `CONTEXT_MODE_DIR`, aligned
`--project`): an 18,539-token corpus, and a targeted query returns only the
relevant sections at **~350 tokens (−98%)**, with BM25 retrieving the correct
sections. This is the **output/data axis** — reduce how much tool-result data
enters context. Portawhip's `route()` is the **selection axis** — reduce which
capability schemas enter context. Neither does the other's job:

| optimizer | axis | mechanism | reduces |
|---|---|---|---|
| Portawhip | capability **selection** (input) | route + abstain | which tool/skill/MCP schemas load |
| context-mode | tool **output** (output) | sandbox exec + FTS5 index/retrieve | how much result-data enters context |

context-mode literally calls itself "the other half of the context problem" —
and the test confirms it. So the earlier "take MCP tools only, skip the hooks
because they're redundant" reasoning is **wrong**: the hook layer (esp.
PreToolUse) is what *enforces* the output-sandboxing, so skipping it weakens the
one thing that makes context-mode complementary. If adopted, adopt it as a
coherent layer, not gutted.

**Verdict (revised after the axis test):** context-mode is a **complementary
output-axis optimizer**, not a competitor — it optimizes tool-result data, which
Portawhip's selection-axis router does not touch. Adopt it as a coherent layer
(tools + hooks), not gutted. Keep it **opt-in / special, not foundry.** All four gates were tested
2026-07-13:
1. **Token-math — MEASURED.** Fixed overhead ≈ **~2,000 tokens** (11 MCP tool
   schemas; `build/adapters/.../mcp-tools.js` = 2,183 tok incl. handler code, so
   schema payload ~1.5–2K) + a SessionStart routing injection (needs a live
   session to measure; est. a few hundred tokens). Saving ≈ 98% per heavy output
   (a 56 KB Playwright snapshot ≈14K tok → sub-1K; a 45 KB log ≈11K tok → sub-1K).
   **Break-even ≈ one heavy-output tool call per session.** Net-positive for
   output-heavy roles (research/scraping/data/browser); net-*negative* (~2K for
   nothing) on light reasoning/small-edit sessions. → special by role, confirmed.
2. **Hook coexistence — MEASURED.** Additive, not multiplicative. context-mode
   contributes the ~2K fixed; Portawhip's route hook contributes ~0 (it abstains
   most of the time). Claude Code runs all hooks on an event in array order; none
   blocks the other (gate 3 confirms pass-through). Combined budget ≈ context-mode's
   ~2K — manageable.
3. **route()-wrap — TESTED (low risk).** Fed context-mode's PreToolUse handler a
   simulated `mcp__harness-router__route` payload: **exit 0, empty output =
   pass-through, no block, no added latency.** (A heavy `cat` also passed through
   standalone — the handler is conservative without a live session, so full
   confirmation still wants a live co-run, but the interference signal is low.)
4. **ELv2 license — RESOLVED.** Terms: no providing the software as a hosted/
   managed service; no removing license notices. **Delegate-install (the user
   installs it from npm under ELv2) is fine; vendoring its code into Portawhip's
   MIT package is not.** Portawhip's delegate-don't-vendor model already sidesteps
   this — another reason it's an opt-in install, never a bundled-in default.
Note: 17K stars in ~4 months is implausible velocity — not a quality signal
(VISION's ECC caution).

## Foundry (default) vs special (opt-in) — decision framework

**Foundry** — ship by default — only if ALL hold: universal across roles;
`token_tax` low or negative (reduces, doesn't add); silent/safe when idle (route
can abstain); dogfood-proven; OSI-compatible license; does not collide with an
existing always-on lane.

**Special / opt-in** if any of: role-specific; adds its own token tax; changes
global behavior; still unproven; non-OSI license; overlaps an existing
writer/hook/router.

Applied:
- **repomix** → foundry-eligible (route-gated to repo-pack).
- **difftastic** → special (review/refactor role; quality not token).
- **context-mode** → special, MCP-tools-only, hooks disabled; never foundry.

## Adoption gate (all candidates)

Same as the writer plan: live-probe on this machine, a `route:` block per
capability, a proven observed gap — and for anything with hooks, a collision
test against Portawhip's own SessionStart/UserPromptSubmit/PostToolUse/PreToolUse
lanes before enabling.
