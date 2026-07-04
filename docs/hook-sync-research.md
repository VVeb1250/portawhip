# Hook sync research

Verified 2026-07-04.

## Goal

Make hook behavior portable by keeping one canonical hook body and rendering the
nearest native lifecycle configuration for each host.

This is not "every host has the same hook API." The actual invariant is:

1. A shared logical hook manifest defines behavior once.
2. Host adapters translate each logical event to the host's native event names.
3. Status reports unsupported hosts honestly instead of falling back silently.

## Sources checked

- Claude Code hooks:
  https://docs.anthropic.com/en/docs/claude-code/hooks
- Codex hooks:
  https://developers.openai.com/codex/hooks
- Gemini CLI hooks:
  https://geminicli.com/docs/hooks/
  https://geminicli.com/docs/hooks/reference/
- OpenCode plugins:
  https://opencode.ai/docs/plugins/

## Current event mapping

| logical hook | Claude Code | Codex | Gemini CLI | OpenCode |
|---|---|---|---|---|
| `user_prompt` | `UserPromptSubmit` | `UserPromptSubmit` | `BeforeAgent` | no direct prompt event found |
| `post_tool` | `PostToolUse` | `PostToolUse` | `AfterTool` | `tool.execute.after` |

## Implemented files

- `hooks.manifest.yaml` — canonical hook declarations.
- `core/hook-targets.mjs` — host event/config mapping.
- `adapters/hooks/universal-hook.mjs` — one command hook body used by all native adapters.
- `scripts/link-hooks.mjs` — status/install/remove for native hook links.

## Current limitations

- Cursor, GitHub Copilot CLI, and VS Code remain instruction/MCP-linked only in
  this repo because no equivalent lifecycle hook API was confirmed in the
  checked docs.
- OpenCode has plugin events and gets a generated local plugin target, but the
  current detected host list on this machine does not include OpenCode.
- Codex hooks require the CLI's hook trust flow before non-managed command hooks
  run. Use `/hooks` in Codex to review newly generated project hooks.
- Project-level Gemini hooks may require trusting the project folder if the CLI
  fingerprints changed hook config.

