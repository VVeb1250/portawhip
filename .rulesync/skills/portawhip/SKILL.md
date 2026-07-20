---
name: portawhip
description: >-
  Manage Portawhip's cross-host canonical configuration, MCP discovery,
  rulesync fan-out, drift checks, backups, ownership ledger, and verification.
  Use for importing or syncing MCP, skills, commands, subagents, rules, hooks,
  permissions, or CLI tools across agent hosts.
---

# Portawhip cross-host configuration

Portawhip uses one writer per lane:

- `rulesync` writes host configuration from `.rulesync/`.
- `mise` installs CLI tools and does not write host configuration.
- `add-mcp` discovers and unions existing MCP servers; its write path is retired.
- `agent-skill-manager` is probe/install fallback only for hosts rulesync cannot target.
- `ai-config-sync-manager` is migration-only; `@agents-dev/cli` is retired.

Never edit generated host files as canonical input. Update `.rulesync/`, preview,
then reconcile.

## Seed MCP canonical state

Discovery unions servers across installed hosts and blocks same-name conflicts.
Literal secret values are omitted; use environment-variable references.

```bash
npm run sync:seed
node scripts/sync/seed-rulesync.mjs apply --scope project --apply
```

Global canonical state lives under `~/.config/portawhip/global/.rulesync/` and
must be seeded separately with `--scope global`.

## Manual reconcile

```bash
portawhip sync check --scope project
portawhip sync apply --scope project --apply
portawhip sync verify --scope project
```

Apply is guarded and performs preview, ownership-drift validation, backup,
generation, and verification. It rolls back when generation or verification
fails. Use `--force` only after reviewing an intentional edit to a generated
file.

Global apply is never implicit:

```bash
portawhip sync check --scope global
portawhip sync apply --scope global --apply
portawhip sync verify --scope global
```

## Automation policy

Do not enable SessionStart auto-sync until one real project reconcile and a
fake-HOME global backup/apply/verify/restore gate pass. Add a watchdog only if
live-probed SessionStart coverage leaves a demonstrated gap.

## Health and inventory

```bash
npm run doctor
npm run surface
npm run tui -- --summary
```

Routing is a separate package (`portawhip-router`). Its commands live there;
portawhip itself no longer has a `route:*` script.

The host capability catalog is evidence-driven. Do not mark a hook or host
surface supported solely from documentation; require a live probe.
