# Phase 0 audit — MCP gateway/tool-gating candidates

Audited 2026-07-04. Real GitHub metadata, not README claims.

| repo | lang | stdio-MCP | dynamic tool exposure | embeddable as library | license | last push | Windows | verdict |
|---|---|---|---|---|---|---|---|---|
| Dumbris/mcpproxy | Python | unverified (docs thin) | unverified | no (standalone proxy) | MIT | 2025-07-22 (**~11.5mo dead**) | unverified | dead |
| metatool-ai/metamcp | TypeScript | yes | yes (aggregator) | **no — Docker-first web app**, own DB/UI/Discord community | MIT | 2026-06-22 (active, 2490⭐, 372 forks) | needs Docker Desktop/WSL2 | alive but wrong shape |
| igrigorik/MCProxy | Rust | unverified | unverified | unverified | MIT | 2025-07-15 (**~11.7mo dead**) | unverified | dead |
| ajbmachon/tool-gating-mcp | Python | unverified | unverified | unverified | none asserted | 2025-06-06 (**~13mo dead**) | unverified | dead |
| RealTapeL/SkillPilot | TypeScript | n/a (skill router, not MCP) | n/a | unverified | none asserted | 2026-04-06 (**~3mo dead, 2-day commit burst**) | unverified | dead/abandoned |

## Finding

4 of 5 candidates are dead (11–13 months no commits) or a 2-day abandoned
burst. The only actively-maintained one, **metamcp**, is a Docker-first
aggregator/orchestrator with its own DB, web UI, and Discord community — not an
embeddable library. Adopting it means running a Docker service (Docker Desktop
+ WSL2 on Windows) just to get `route()`/`use()`, which contradicts the
no-daemon/CLI-first, Windows-clean, low-token-tax posture this project has held
since Step 1.

**No candidate is embeddable, maintained, and Windows-clean at the same time.**

## Recommendation: Option B

Router returns *pointers only* (id, description, path/command) — no
tool-call passthrough (`use()` omitted from v1). Hosts keep their existing
direct MCP connections (already true today: Claude Code, Codex etc. each
already hold their own MCP config, wired in Step 1 via add-mcp). The router's
job is narrower and cheaper: decide *whether to surface a pointer*, not proxy
the call. Revisit aggregation later only if a lightweight embeddable
candidate appears (bench it fresh — don't assume today's audit stays valid).
