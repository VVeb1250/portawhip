<!-- harness-router:start -->
Before starting a task, call `route(task summary)` on the harness-router MCP
server and follow any returned pointers. If `route`/`list_all` show up as
deferred/pending tools rather than directly callable, first call ToolSearch
with query "select:mcp__harness-router__route,mcp__harness-router__list_all"
to load them, then call route(). An empty result from route() is normal and
means nothing relevant is installed — proceed without it.
<!-- harness-router:end -->
