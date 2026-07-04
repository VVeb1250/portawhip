# Phase 3 verify — push mode (Claude Code)

## What was built

- `adapters/claude-code/push-hook.mjs` — UserPromptSubmit hook. Reads
  `{prompt}` on stdin, calls the same `core/registry.mjs` +
  `core/route-entry.mjs` used by the CLI and the pull-mode MCP server,
  emits `hookSpecificOutput.additionalContext` capped at
  `router.config.yaml`'s `pushBudgetChars` (default 320) on a match, emits
  **nothing** on stdout on abstain/short-prompt/slash-command/error. All
  paths anchor to this repo via `import.meta.url`, not the caller's cwd
  (same fix as `server/mcp-server.mjs`), since the hook is registered
  globally and fires from any project.
- `scripts/install-push-hook.mjs` — idempotent installer for a
  `settings.json`'s `hooks.UserPromptSubmit` array. `status` / `install` /
  `remove`, `--dry-run` to preview, always backs up to
  `<path>.bak-<timestamp>` before writing. Detects the user's old
  `skill-router.py` hook but never removes it unless `--disable-old-hook`
  is passed explicitly (VISION.md's rule: ask before touching).

## Installed

`node scripts/install-push-hook.mjs install` run against
`~/.claude/settings.json` on 2026-07-04, with user confirmation first
(global config write). Backup: `settings.json.bak-1783144932808`.
Old `skill-router.py` hook is **still active, untouched** — both hooks fire
side by side for now.

## Eval

Hard requirement (silence on non-match) — **5/5 pass**:
"what is your favorite color", "tell me a joke about cats", "explain
quantum entanglement briefly", "write a poem about the ocean", "how was
your day today" → all silent (no stdout).

Should-match set — **3/5 clean, 1 wrong-target, 1 miss (pdf) + 1 more
miss found while writing this**:
- "search codebase for the word foo" → `ripgrep` ✅
- "how to use the stripe api sdk" → `context7` ✅
- "give me library docs for react" → hit `react-testing` (auto-discovered
  skill) instead of the curated `context7` entry — same-topic, wrong pick
- "convert this pdf to text" → silent, should have hit `pdf` (known gap,
  already flagged in the router review before Phase 3 started)
- "grep for TODO comments" → silent, should have hit `ripgrep` despite the
  literal trigger word "grep" appearing in the prompt

This is below the PLAN.md Phase 3 spec's literal "≥4/5 correct" bar.
**Deliberate call (user, 2026-07-04):** ship Phase 3 anyway and land
Phase 4's feedback loop instead of hand-tuning thresholds now — usage data
from real sessions should target the actual miss pattern more precisely
than another round of manual threshold guessing (this project's whole
premise is "no more hardcoded routing logic tuned by hand"). These 3 cases
are logged here so Phase 4's feedback weighting has known targets to
verify against, not just aggregate pass/fail.

## Exit criteria status

- Old hook detect + no-silent-removal: done.
- New hook installed, verified live via manual stdin tests (not yet
  observed firing inside a real interactive Claude Code session — same
  caveat as Phase 2's route() gap, only closable from a fresh session).
- Precision bar: **not met**, explicitly deferred to Phase 4 (see above).
