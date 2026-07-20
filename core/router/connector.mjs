// The router's instruction connector: what a host's model is told about
// route() before it starts a task.
//
// This text used to live in adapters/instructions/generate.mjs, which meant
// every portawhip install advertised a router whether or not one was present.
// It belongs to the router, travels with it, and is removed with it.

// Plain wording — safe default for hosts with no lazy tool-loading concept
// (Codex/AGENTS.md verified 8/8 route() calls with this text alone).
const GENERIC_BODY = `Before starting a task, call \`route(task summary)\` on the harness-router MCP
server and follow any returned pointers. Pass only the positively requested action
and its direct object; do not copy the raw prompt. Drop chit-chat, venting,
background, and any rejected, negated, or hypothetical option. If a request is
buried in chat, route only the request; if the message names several distinct
actions, call route once per action.
Example: "ugh CI is flaky again, anyway find where we parse the auth token" ->
route("find the code that parses the auth token").
An empty result is normal and means nothing relevant is installed — proceed without it.`;

// Claude Code defers MCP tool schemas behind ToolSearch until looked up by
// name — confirmed live: harness-router's route/list_all showed as deferred
// at session start and were never called (0/8 in Phase 2 verify), because
// the generic wording never told the model to look them up first.
const CLAUDE_CODE_BODY = `Before starting a task, call \`route(task summary)\` on the harness-router MCP
server and follow any returned pointers. Pass only the positively requested action
and its direct object; do not copy the raw prompt. Drop chit-chat, venting,
background, and any rejected, negated, or hypothetical option. If a request is
buried in chat, route only the request; if the message names several distinct
actions, call route once per action.
Example: "ugh CI is flaky again, anyway find where we parse the auth token" ->
route("find the code that parses the auth token").
If \`route\`/\`list_all\` show up as deferred/pending tools rather than directly
callable, first call ToolSearch with query
"select:mcp__harness-router__route,mcp__harness-router__list_all" to load them,
then call route(). An empty result from route() is normal and means nothing
relevant is installed — proceed without it.`;

export const ROUTER_CONNECTOR = {
  id: "harness-router",
  summary: "Route tasks through the project harness-router before starting work",
  body: GENERIC_BODY,
  bodyFor(host) {
    return host === "claude-code" ? CLAUDE_CODE_BODY : GENERIC_BODY;
  },
};
