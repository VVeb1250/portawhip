#!/usr/bin/env bash
# 3-way MCP-writer head-to-head: add-mcp vs @agents-dev/cli vs ai-config-sync-manager
# Metrics: correctness, idempotency, backup/rollback, drift-war.
# SAFETY: project-scope only, isolated temp dirs, real HOME guarded (assert mtime unchanged).
set -u
BIN="/e/portable-harness-v2/node_modules/.bin"
ROOT="/c/Users/VVeb1250/AppData/Local/Temp/claude/E--portable-harness-v2/5a00dae3-6e5e-4591-afcb-3ca163856b6f/scratchpad/h3"
REAL="/c/Users/VVeb1250/.claude.json"
S1="https://mcp.deepwiki.com/mcp"
S2="https://mcp.context7.com/mcp"

rm -rf "$ROOT"; mkdir -p "$ROOT"
GUARD_BEFORE=$([ -f "$REAL" ] && stat -c %Y "$REAL" || echo none)

hashdir() { find "$1" -type f -not -path '*/node_modules/*' -not -name '*.bak' -not -name '*.old' 2>/dev/null \
  | sort | while read -r f; do printf '%s ' "${f#$1}"; md5sum "$f" | cut -d' ' -f1; done | md5sum | cut -d' ' -f1; }
files() { find "$1" -type f -not -path '*/node_modules/*' 2>/dev/null | sed "s#$1/##" | sort; }

echo "############ METRIC A+B: CORRECTNESS + IDEMPOTENCY ############"

echo "===== add-mcp ====="
D="$ROOT/addmcp"; mkdir -p "$D"; cd "$D"
"$BIN/add-mcp" "$S1" --transport http --name deepwiki --agent claude-code,codex --yes >/dev/null 2>&1
"$BIN/add-mcp" "$S2" --transport http --name context7 --agent claude-code,codex --yes >/dev/null 2>&1
echo "files:"; files "$D"
H1=$(hashdir "$D")
# idempotency: re-add same 2
"$BIN/add-mcp" "$S1" --transport http --name deepwiki --agent claude-code,codex --yes >/dev/null 2>&1
"$BIN/add-mcp" "$S2" --transport http --name context7 --agent claude-code,codex --yes >/dev/null 2>&1
H2=$(hashdir "$D")
echo "idempotent: $([ "$H1" = "$H2" ] && echo YES || echo NO)  ($H1 vs $H2)"
echo "--- .mcp.json ---"; cat "$D/.mcp.json" 2>/dev/null
echo "--- codex config? ---"; cat "$D/.codex/config.toml" 2>/dev/null || cat "$D/.mcp.json" 2>/dev/null | head -0; find "$D" -path '*codex*' -type f 2>/dev/null
echo "backup files:"; find "$D" \( -name '*.bak' -o -name '*.old' -o -name '*~' \) 2>/dev/null | sed "s#$D/##"

echo
echo "===== @agents-dev/cli ====="
D="$ROOT/agents"; mkdir -p "$D"; cd "$D"
"$BIN/agents" init --no-update-check >/dev/null 2>&1
"$BIN/agents" mcp add "$S1" --name deepwiki --no-update-check >/dev/null 2>&1
"$BIN/agents" mcp add "$S2" --name context7 --no-update-check >/dev/null 2>&1
"$BIN/agents" connect --llm claude,codex --no-update-check >/dev/null 2>&1
echo "files:"; files "$D" | grep -vE 'README|skill-guide|docs-research|mcp-troubleshooting'
H1=$(hashdir "$D")
"$BIN/agents" connect --llm claude,codex --no-update-check >/dev/null 2>&1
"$BIN/agents" sync --no-update-check >/dev/null 2>&1
H2=$(hashdir "$D")
echo "idempotent: $([ "$H1" = "$H2" ] && echo YES || echo NO)  ($H1 vs $H2)"
echo "--- .agents/agents.json mcp block ---"; node -e "try{const j=require('$D/.agents/agents.json');console.log(JSON.stringify(j.mcp||{},null,1))}catch(e){console.log('ERR',e.message)}"
echo "--- materialized codex ---"; cat "$D/.codex/config.toml" 2>/dev/null | head -20; find "$D" -path '*codex*' -o -path '*.mcp.json' 2>/dev/null | sed "s#$D/##" | grep -iE 'codex|mcp'
echo "--- materialized claude .mcp.json ---"; cat "$D/.mcp.json" 2>/dev/null
echo "reset support:"; "$BIN/agents" reset --help --no-update-check 2>&1 | grep -iE 'reset|backup|clean' | head -3

echo
echo "===== ai-config-sync-manager (claude -> codex) ====="
D="$ROOT/ai"; mkdir -p "$D/.claude"; cd "$D"
# seed claude project source: .mcp.json with 2 servers
cat > "$D/.mcp.json" <<JSON
{ "mcpServers": {
  "deepwiki": { "type": "http", "url": "$S1" },
  "context7": { "type": "http", "url": "$S2" }
} }
JSON
printf '# Project\nrules here\n' > "$D/CLAUDE.md"
echo "--- dry-run plan ---"
"$BIN/ai-config-sync" sync --scope project --from claude --to codex --dry-run 2>&1 | head -20
"$BIN/ai-config-sync" sync --scope project --from claude --to codex --apply 2>&1 | tail -8
echo "files after apply:"; files "$D"
H1=$(hashdir "$D")
"$BIN/ai-config-sync" sync --scope project --from claude --to codex --apply >/dev/null 2>&1
H2=$(hashdir "$D")
echo "idempotent: $([ "$H1" = "$H2" ] && echo YES || echo NO)  ($H1 vs $H2)"
echo "--- codex output ---"; cat "$D/.codex/config.toml" 2>/dev/null | head -20; cat "$D/AGENTS.md" 2>/dev/null | head -5
echo "backup files:"; find "$D" \( -name '*.bak' -o -name '*.old' -o -name '*~' \) 2>/dev/null | sed "s#$D/##"

echo
echo "############ METRIC D: DRIFT WAR (two writers, one codex target) ############"
D="$ROOT/drift"; mkdir -p "$D"; cd "$D"
# seed shared claude source
cat > "$D/.mcp.json" <<JSON
{ "mcpServers": {
  "deepwiki": { "type": "http", "url": "$S1" },
  "context7": { "type": "http", "url": "$S2" }
} }
JSON
printf '# Project\n' > "$D/CLAUDE.md"
# writer B = ai-config-sync claude->codex
"$BIN/ai-config-sync" sync --scope project --from claude --to codex --apply >/dev/null 2>&1
HB=$(md5sum "$D/.codex/config.toml" 2>/dev/null | cut -d' ' -f1); echo "after ai-config-sync: codex hash=$HB"; cat "$D/.codex/config.toml" 2>/dev/null | head -15
# writer A = agents materialize (needs .agents source with same servers)
"$BIN/agents" init --no-update-check >/dev/null 2>&1
"$BIN/agents" mcp add "$S1" --name deepwiki --no-update-check >/dev/null 2>&1
"$BIN/agents" mcp add "$S2" --name context7 --no-update-check >/dev/null 2>&1
"$BIN/agents" connect --llm codex --no-update-check >/dev/null 2>&1
HA=$(md5sum "$D/.codex/config.toml" 2>/dev/null | cut -d' ' -f1); echo "after agents connect: codex hash=$HA"; cat "$D/.codex/config.toml" 2>/dev/null | head -25
# re-run ai-config-sync: does it clobber agents' version?
"$BIN/ai-config-sync" sync --scope project --from claude --to codex --apply >/dev/null 2>&1
HB2=$(md5sum "$D/.codex/config.toml" 2>/dev/null | cut -d' ' -f1); echo "after ai-config-sync again: codex hash=$HB2"
echo "DRIFT VERDICT: $([ "$HA" = "$HB2" ] && echo 'STABLE (coexist)' || echo 'OSCILLATES (writers fight)')"

echo
GUARD_AFTER=$([ -f "$REAL" ] && stat -c %Y "$REAL" || echo none)
echo "############ SAFETY GUARD ############"
echo "real ~/.claude.json mtime before=$GUARD_BEFORE after=$GUARD_AFTER  $([ "$GUARD_BEFORE" = "$GUARD_AFTER" ] && echo UNCHANGED_OK || echo CHANGED_ALERT)"
