<!-- harness-router:start -->
Before starting a task, call `route(task summary)` on the harness-router MCP
server and follow any returned pointers. Pass only the positively requested action
and its direct object; do not copy the raw prompt. Drop chit-chat, venting,
background, and any rejected, negated, or hypothetical option. If a request is
buried in chat, route only the request; if the message names several distinct
actions, call route once per action.
Example: "ugh CI is flaky again, anyway find where we parse the auth token" ->
route("find the code that parses the auth token").
An empty result is normal and means nothing relevant is installed — proceed without it.
<!-- harness-router:end -->
