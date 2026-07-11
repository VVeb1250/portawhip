# Phase 2 live-behavior check — prompt template

Purpose: confirm the model actually calls `route()` on its own in a **fresh**
Claude Code / Codex CLI session, per the instruction installed in
`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md`. Not provable from within an
already-running session — must be run in a new one.

## How to run

1. Open a brand-new session (new terminal/window, not this one).
2. Paste each prompt below one at a time (separate turns, or separate fresh
   sessions if you want zero context bleed between prompts).
3. Watch the tool-call transcript for a call to `route` (or `list_all`) on
   the `harness-router` MCP server, before the model starts answering.
4. Fill in Pass/Fail + notes. Repeat on the second host.

## Should call route() and follow the pointer

| # | Prompt | Expected match | Expected pointer |
|---|---|---|---|
| 1 | "extract table from this pdf" | `anthropic-skills` (curated) | `skills/pdf` |
| 2 | "grep for TODO comments in this codebase" | `ripgrep` (curated) | `ripgrep` CLI |
| 3 | "show me the docs for how to use this sdk" | `context7` (curated) | context7 MCP tool |
| 4 | "PostgreSQL schema design and query optimization" | `postgres-patterns` (auto) | skill path |
| 5 | "walk me through a zero-downtime database migration" | `database-migrations` (auto) | skill path |

## Should call route(), get [], and proceed normally without inventing a match

| # | Prompt | Expected result |
|---|---|---|
| 6 | "write a poem about the ocean" | `[]` — no capability is relevant |
| 7 | "what's the capital of France" | `[]` |
| 8 | "explain how TCP handshake works" | `[]` |

## Recording sheet

Run 2026-07-04 via headless sessions (`claude -p --output-format stream-json`,
`codex exec --json --skip-git-repo-check`), cwd inside/derived from this
project, default models (claude-sonnet-5 / gpt-5.5). Tool-call transcripts
saved to session scratchpad (`p2-claude-*.jsonl`, `p2-codex-*.jsonl`).
Codex rows were then re-checked in an interactive Codex session where the
`harness-router.route` approval prompt could be accepted.

| # | Host | Called route()? | Matched expected? | Followed pointer correctly? | Notes |
|---|---|---|---|---|---|
| 1 | Claude Code | ❌ No | — | — | No tools; asked "where PDF at?" |
| 1 | Codex CLI | ✅ Yes | ✅ Yes | ✅ Yes | Interactive route returned `anthropic-skills` -> `skills/pdf`; headless also read `skills/pdf/SKILL.md` |
| 2 | Claude Code | ❌ No | — | — | Went straight to built-in Grep ×2 |
| 2 | Codex CLI | ✅ Yes | ✅ Yes | ✅ Yes | Interactive route returned `ripgrep` -> `ripgrep`; answer used `rg` |
| 3 | Claude Code | ❌ No | — | — | No tools; asked which SDK |
| 3 | Codex CLI | ✅ Yes ×2 | ✅ Yes | ✅ Yes | Interactive route returned `context7` -> context7 MCP; headless used context7 docs |
| 4 | Claude Code | ❌ No | — | — | No tools; asked for specifics |
| 4 | Codex CLI | ✅ Yes | ✅ Yes | ✅ Yes | Interactive route returned `postgres-patterns` skill pointer |
| 5 | Claude Code | ❌ No | — | — | Read one file, answered from knowledge |
| 5 | Codex CLI | ✅ Yes | ✅ Yes | ✅ Yes | Interactive route returned `database-migrations` skill pointer |
| 6 | Claude Code | ❌ No (abstain OK) | — | — | Answered directly — passes per bar |
| 6 | Codex CLI | ✅ Yes | ✅ Yes (`[]`) | N/A | Interactive route returned `[]`; direct answer is correct |
| 7 | Claude Code | ❌ No (abstain OK) | — | — | "Paris." — passes per bar |
| 7 | Codex CLI | ✅ Yes | ✅ Yes (`[]`) | N/A | Interactive route returned `[]`; direct answer is correct |
| 8 | Claude Code | ❌ No (abstain OK) | — | — | Answered directly — passes per bar |
| 8 | Codex CLI | ✅ Yes | ✅ Yes (`[]`) | N/A | Interactive route returned `[]`; direct answer is correct |

\* Headless Codex called `route()` on **8/8 prompts**, but every
harness-router call was auto-cancelled ("user cancelled MCP tool call")
because headless `codex exec` with `approval_policy = "on-request"` has no one
to approve. Interactive Codex approval re-check filled the real router output:
rows 1-5 matched the expected top hit; rows 6-8 returned `[]`.

Claude Code detail: `harness-router` showed status `pending` at session init
(tools deferred behind ToolSearch); model never waited, never ToolSearch'd it,
and never attempted `route()` despite the CLAUDE.md one-liner being loaded.
0/8 route calls.

## Verdict (headless + interactive Codex run, 2026-07-04)

- **Codex CLI: PASS** on the "calls route()" criterion — 8/8, including
  negative prompts. Interactive approval confirms the router returns the
  expected matches/pointers for rows 1-5 and `[]` for rows 6-8.
- **Claude Code: FAIL** — 0/8. The CLAUDE.md one-liner alone does not make the
  model call route() when the MCP server is deferred/pending at turn start.
  Likely fixes to test: UserPromptSubmit hook that injects route() results
  directly (like the existing skill-router hook), or instruction wording that
  forces a ToolSearch for the deferred tool first.

Incidental fixes made during this run: removed conflicting `command`/`args`
from `[mcp_servers.context7]` in `~/.codex/config.toml` (codex refused to
start: "url is not supported for stdio"); backup at
`config.toml.bak-p2verify`.

## Router sanity check (pre-verified 2026-07-04)

Every prompt above was fired at `route()` directly and the expected match came
back as the top hit (rows 1-5) or `[]` (rows 6-8). So a failure during the
live run means the *model* didn't call or follow the router — not that the
router mis-scored. Note: scorer is keyword-based; row 4's original phrasing
("help me design a postgres schema with proper indexing") scored
`mysql-patterns` higher, hence the current wording.

## Pass bar (from PLAN.md Phase 2 exit criteria)

Both hosts route successfully with zero host-specific code beyond the
instruction one-liner — i.e. rows 1-5 call route() and follow the pointer on
both hosts, and rows 6-8 either abstain silently or call route(), see `[]`,
and proceed without fabricating a match.
