#!/usr/bin/env bash
# Global-scope writer tests: drift (add-mcp -g vs ai-config-sync --scope global)
# and rulesync candidate eval. SAFETY: HOME/USERPROFILE overridden to a fake
# home so NO real global config is touched; real ~/.codex + ~/.claude.json are
# hashed before/after and asserted UNCHANGED. Companion to
# writer-consolidation-plan.md §1c/§1d.
set -u
BIN="/e/portable-harness-v2/node_modules/.bin"
SB="${SCRATCH:-/tmp}/gscope"; rm -rf "$SB"
S1="https://mcp.deepwiki.com/mcp"; S2="https://mcp.context7.com/mcp"
RC="$HOME/.codex/config.toml"; RJ="$HOME/.claude.json"
RC0=$([ -f "$RC" ] && md5sum "$RC"|cut -d' ' -f1||echo none)
RJ0=$([ -f "$RJ" ] && md5sum "$RJ"|cut -d' ' -f1||echo none)

echo "########## GLOBAL DRIFT: add-mcp -g vs ai-config-sync --scope global ##########"
F="$SB/drift"; mkdir -p "$F/.codex"; printf '{}' > "$F/.claude.json"
CODEX="$F/.codex/config.toml"; h(){ md5sum "$CODEX" 2>/dev/null|cut -d' ' -f1; }
run(){ HOME="$F" USERPROFILE="$F" "$@"; }
run "$BIN/add-mcp" "$S1" --transport http --name deepwiki -g -a claude-code -a codex --yes >/dev/null 2>&1
run "$BIN/add-mcp" "$S2" --transport http --name context7 -g -a claude-code -a codex --yes >/dev/null 2>&1
G1=$(h)
run "$BIN/ai-config-sync" sync --scope global --from claude --to codex --apply 2>&1 | tail -2
G2=$(h)
run "$BIN/add-mcp" "$S1" --transport http --name deepwiki -g -a codex --yes >/dev/null 2>&1
G3=$(h)
echo "G1=$G1 G2=$G2 G3=$G3"
[ "$G1" = "$G2" ] && [ "$G2" = "$G3" ] && echo "STABLE (surgical writers coexist)" || echo "OSCILLATES"

echo
echo "########## rulesync candidate: global generate + non-MCP survival ##########"
F="$SB/rs"; mkdir -p "$F/.codex"; RS="npx --yes rulesync@latest"; run(){ HOME="$F" USERPROFILE="$F" "$@"; }
cd "$F"
run $RS init >/dev/null 2>&1
cat > "$F/.rulesync/mcp.json" <<JSON
{ "mcpServers": { "deepwiki": {"type":"http","url":"$S1"}, "context7": {"type":"http","url":"$S2"} } }
JSON
# critical: seed non-MCP user state that must survive
cat > "$F/.claude.json" <<'JSON'
{ "projects": {"E:/myrepo": {"history":["important"]}}, "userID":"keep-me", "mcpServers":{} }
JSON
run $RS generate -g --targets claudecode,codexcli --features mcp 2>&1 | grep -viE 'deprecated|npm warn' | tail -3
cd "$F"; node -e "const j=JSON.parse(require('fs').readFileSync('.claude.json','utf8'));console.log('SURVIVAL projects='+!!j.projects+' userID='+j.userID+' mcp='+Object.keys(j.mcpServers||{}))"
run $RS generate -g --targets claudecode,codexcli --features mcp --check 2>&1 | grep -viE 'deprecated|npm warn' | tail -1

echo
echo "########## SAFETY ##########"
RC1=$([ -f "$RC" ] && md5sum "$RC"|cut -d' ' -f1||echo none)
RJ1=$([ -f "$RJ" ] && md5sum "$RJ"|cut -d' ' -f1||echo none)
echo "real ~/.codex: $([ "$RC0" = "$RC1" ] && echo UNCHANGED_OK || echo CHANGED_ALERT)"
echo "real ~/.claude.json: $([ "$RJ0" = "$RJ1" ] && echo UNCHANGED_OK || echo 'CHANGED (live session state)')"
