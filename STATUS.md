# Release Status

Current status: release checklist passed locally on Windows.

Release checklist:

- [x] `npm test` - 120/120 passed
- [x] `npm run route:eval` - passed, falsePositiveCount 0
- [x] `npm run sync-config` - passed using pinned local `ai-config-sync-manager`
- [x] `npm run sync-config:preview` - dry-run path passed using pinned local `ai-config-sync-manager`
- [x] `npm run connectors` - project connector links all linked
- [x] `node scripts/doctor.mjs` - unified status OK
- [x] `node scripts/tui.mjs --help`
- [x] `node scripts/tui.mjs --summary`
- [x] `node core/router-cli.mjs route --prompt "connector readiness"` completes without timing out
- [x] `npm audit` - 0 vulnerabilities

Notes:

- Config sync uses the pinned `ai-config-sync-manager` dev dependency by default.
- Unpinned `npx --yes` fallback requires explicit `--allow-npx` or `PORTAWHIP_ALLOW_NPX=1`.
- `router-cli route` is non-blocking on dense retrieval by default; use `--dense-block` only when waiting is intentional.
- TUI summary still reports real attention items: global `mcp-only` connector rows, project hook rows missing where global hooks are already linked, and one bare-name enrichment.
