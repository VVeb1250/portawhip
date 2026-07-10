# Host support matrix

Which AI coding-agent hosts portawhip syncs, per surface — and, where a
surface is not supported, the concrete reason. This is the "will it work for
me?" reference for anyone adopting portawhip.

Detection is delegated to `add-mcp` (primary) plus a small supplementary
detector (`core/extra-hosts.mjs`) for newer harnesses add-mcp hasn't
catalogued yet. A host is only ever targeted when its config dir actually
exists on the machine — nothing is created for an absent host.

Legend: ✅ supported · ➖ delegated/automatic · ⚠️ partial · ❌ unsupported
(reason given) · — not applicable.

## Surfaces

| surface | how it syncs |
|---|---|
| instructions | marker-managed block in each host's context file (`CLAUDE.md`/`AGENTS.md`/`GEMINI.md`/rules) via `link-connectors` |
| MCP servers | delegated to `add-mcp`; `.agents/agents.json` fans out via `@agents-dev/cli` |
| skills | delegated to `agent-skill-manager` (asm) + `.agents/skills` |
| commands | managed-copy of markdown into each host's command dir via `link-surfaces` |
| agents (subagents) | managed-copy of markdown into each host's agent dir via `link-surfaces` |
| hooks (native) | marker-managed lifecycle hooks via `link-hooks` |
| hooks (embedded) | inventory only (`discover-hooks`); linking deferred (trust boundary) |

## Matrix

| host | instructions | MCP | skills | commands | agents | native hooks | detected by |
|---|---|---|---|---|---|---|---|
| Claude Code | ✅ CLAUDE.md | ➖ add-mcp | ➖ asm | ✅ `~/.claude/commands` | ✅ `~/.claude/agents` | ✅ UserPromptSubmit/PostToolUse/SessionStart | add-mcp |
| Codex | ✅ AGENTS.md | ➖ add-mcp | ➖ asm | ✅ `~/.codex/prompts` | ✅ `~/.codex/agents` | ✅ hooks.json | add-mcp |
| Gemini CLI | ✅ GEMINI.md | ➖ add-mcp | ➖ asm | ❌ TOML format (no md copy) | ❌ no md agent dir | ✅ BeforeAgent/AfterTool | add-mcp |
| Cursor | ✅ `.cursor/rules` + AGENTS.md | ➖ add-mcp | ➖ asm | ❌ no documented md command dir | ❌ no subagent dir | ❌ no documented lifecycle hook API | add-mcp |
| VS Code / Copilot | ✅ copilot-instructions.md | ➖ add-mcp | ➖ asm | ❌ no md command dir | ❌ n/a | ❌ no lifecycle hook API | add-mcp |
| OpenCode | ✅ AGENTS.md | ➖ add-mcp | ➖ asm | ⚠️ not yet mapped | ⚠️ not yet mapped | ⚠️ tool events only (no user-prompt) | add-mcp |
| Zed | ✅ AGENTS.md | ➖ add-mcp | ➖ asm | ❌ not markdown dirs | ❌ n/a | ❌ no lifecycle hook API | add-mcp |
| Windsurf | ✅ rules + AGENTS.md | ➖ add-mcp | ➖ asm | ❌ no md command dir | ❌ n/a | ❌ no lifecycle hook API | add-mcp |
| Cline / Cline CLI | ✅ `.clinerules` | ➖ add-mcp | ➖ asm | ❌ no md command dir | ❌ n/a | ❌ no lifecycle hook API | add-mcp |
| Pi | ✅ AGENTS.md (`~/.pi/agent`) | ❌ no native MCP (extensions only) | ✅ reads `.agents/skills` directly | ✅ `~/.pi/agent/prompts` | ❌ no native subagents | ❌ hooks via TS extensions only (no declarative file) | extra-hosts |
| Amp | ✅ AGENTS.md (`~/.config`) | ➖ its own MCP | ✅ `~/.config/amp/skills` | ❌ no documented md command dir | ❌ no subagent dir | ❌ no documented declarative hook file | extra-hosts |

## Why the gaps (reasons, not omissions)

- **Gemini commands/agents — format mismatch.** Gemini custom commands are
  TOML, not markdown; copying a `.md` would not load. Instructions + native
  hooks still work. (v1 does frontmatter-passthrough only, no translation.)
- **Cursor / VS Code / Zed / Windsurf / Cline hooks — no lifecycle hook API.**
  These hosts document rules/instructions but no user-prompt/post-tool hook
  surface we can safely write. Reported `unsupported`, never faked.
- **Cursor / VS Code / Zed / Windsurf commands & agents — no markdown dir.**
  No documented per-host markdown command/subagent directory to copy into.
  Instructions (their real extension point) are fully supported.
- **Pi MCP / subagents — not built in.** Pi's philosophy is a four-tool core
  extended via TypeScript; MCP and subagents are "build your own", so there is
  no declarative target. Pi's skills come free because it reads `.agents/skills`
  — the same canonical dir portawhip already writes.
- **Pi / Amp hooks — no declarative hook file.** Both support event handlers
  only through code extensions, not a config file we can manage.
- **Embedded hooks (all hosts) — inventory only.** Activating a hook bundled
  in a third-party skill/plugin runs its command on lifecycle events — a trust
  boundary. portawhip lists them (`npm run hooks:embedded`) but does not
  auto-link them.

## Adding a host

1. Confirm the host's config conventions from its official docs (cite the URL).
2. If add-mcp already detects it, add its surface paths to the relevant data
   catalog: `core/connector-targets.mjs` (instructions),
   `core/surface-copy-targets.mjs` (commands/agents), `core/hook-targets.mjs`
   (native hooks). If add-mcp does not detect it, add it to
   `core/extra-hosts.mjs` with a presence path + surface map + source URL.
3. Mark any surface the host genuinely lacks as `unsupported` with the reason —
   never fake a target.
4. Add a row here and a test. Run `npm run doctor` to see it live-probed.
