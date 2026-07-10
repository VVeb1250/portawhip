# Phase S4 verify — host widening + support matrix

Verified 2026-07-10 on this Windows machine.

## What shipped

- `core/extra-hosts.mjs` — supplementary, presence-checked detector for hosts
  add-mcp doesn't catalogue yet (Pi, Amp), each entry citing its doc source +
  a surface support map. add-mcp stays the primary detector; this only fills
  the proven gap and is inert until such a host is installed.
- `scripts/hosts.mjs` — `detectHosts()` now returns `extraHosts` (separate
  from `mcpHosts`, so add-mcp's MCP-linking path is never handed a host it
  doesn't know).
- `core/connector-targets.mjs` — Pi + Amp instruction targets (AGENTS.md,
  evidence-linked). `scripts/link-connectors.mjs` links instructions for
  present extra hosts (`mcpStatus: n/a`).
- `core/surface-copy-targets.mjs` — Pi command target (`~/.pi/agent/prompts`);
  Pi agents unsupported (no native subagents). `link-surfaces` now
  presence-gates every host so no config dir is created for an absent host.
- `docs/host-support.md` — the full host × surface matrix with a concrete
  reason for every gap.
- `README.md` — new "Cross-host capability sync" + "Host support" sections.
- `core/extra-hosts.test.mjs` (3). Full suite 185/185.

## Research (evidence, cited in the catalogs + matrix)

- **Pi** (earendil-works/pi): reads `AGENTS.md` (+ `~/.pi/agent/AGENTS.md`);
  skills from `.agents/skills` (the same canonical dir portawhip writes — free
  fan-out); prompt templates in `~/.pi/agent/prompts`; no native
  subagents/MCP/declarative hooks.
  Source: github.com/badlogic/pi-mono/.../coding-agent/README.md
- **Amp** (Sourcegraph): reads `AGENTS.md` (+ `~/.config/AGENTS.md`); skills in
  `~/.config/amp/skills`; MCP supported; no documented declarative hook file.
  Source: ampcode.com/manual

## Observed

- add-mcp detects here: claude-code, claude-desktop, codex, cursor, gemini-cli,
  github-copilot-cli, vscode. No extra host (Pi/Amp/…) installed → detector
  returns `[]`, catalogs inert, nothing created. Correct (no overclaim).
- `link-connectors status` shows no Pi/Amp rows (absent). `link-surfaces
  status` is present-gated.
- Every catalog addition is data with a cited source; every gap in
  `docs/host-support.md` has a stated reason (format mismatch / no hook API /
  not built-in / trust boundary).

## Verify

- [x] new hosts added as evidence-based data (Pi, Amp) with source URLs
- [x] detection widened without rebuilding add-mcp's path (separate
  `extraHosts`, presence-checked)
- [x] absent hosts never targeted / no dirs created (present-gate)
- [x] every unsupported cell has a documented reason (host-support.md)
- [x] README points adopters at the matrix
- [x] full suite 185/185

## Note

Pi/Amp support is verified from their docs but not dogfooded (neither is
installed here). The presence gate means it activates correctly if a user
installs one; until then it is documented and inert — honest per VISION's
live-probe rule.
