import { readActiveSelection, resolveRecipePaths } from "../state/bundle-state.mjs";
import { capabilityKind } from "../registry/capability-kind.mjs";
import { DEFAULT_CACHE_PATH, readEnrichmentCache } from "../registry/enrich.mjs";
import { loadIndex } from "../registry/registry.mjs";
import { resolve } from "node:path";
import { collectConnectorLinks } from "../../scripts/link/link-connectors.mjs";
import { collectHookLinks } from "../../scripts/link/link-hooks.mjs";
import { collectSurfaceMatrix } from "./surface-matrix.mjs";

const SCOPES = ["project", "global"];

function statusRank(status) {
  if (status === "missing") return 2;
  if (status === "bare-name") return 2;
  if (status === "unsupported" || status === "mcp-only") return 1;
  return 0;
}

function summarize(rows, getStatus) {
  const counts = {};
  for (const row of rows) {
    const status = getStatus(row);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function capabilityRows(index) {
  return index.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    kind: capabilityKind(entry.type),
    origin: entry.origin,
    source: entry.source ?? null,
    path: entry.path ?? null,
    description: entry.route?.description ?? null,
    status: "available",
  }));
}

function enrichmentRows(capabilities, cache) {
  return capabilities
    .filter((entry) => entry.type === "mcp" || entry.type === "cli")
    .filter((entry) => entry.origin?.startsWith("auto:"))
    .map((entry) => {
      const enriched = cache[entry.id] ?? null;
      return {
        id: entry.id,
        type: entry.type,
        origin: entry.origin,
        status: enriched ? "enriched" : "bare-name",
        triggerCount: enriched?.triggers?.length ?? entry.route?.triggers?.length ?? 0,
        description: enriched?.description ?? entry.route?.description ?? null,
        enrichedAt: enriched?.enrichedAt ?? null,
      };
    })
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

export async function collectSurfaceInventory({ cwd = process.cwd() } = {}) {
  const recipePaths = resolveRecipePaths(cwd, readActiveSelection(cwd));
  const index = await loadIndex(recipePaths);
  const capabilities = capabilityRows(index);
  const enrichCachePath = resolve(cwd, DEFAULT_CACHE_PATH);
  const enrichments = enrichmentRows(index.entries, readEnrichmentCache(enrichCachePath));
  const hooks = [];
  const connectors = [];

  for (const scope of SCOPES) {
    hooks.push(...(await collectHookLinks({ command: "status", scope })).rows);
    connectors.push(...(await collectConnectorLinks({ command: "status", scope })).rows);
  }

  // Full surface coverage matrix (Phase S0): heavy=true so mcp/skill read
  // lanes report real discovery counts, not the light "declared" placeholder.
  const matrix = await collectSurfaceMatrix({ cwd, heavy: true });

  hooks.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.hostId.localeCompare(b.hostId));
  connectors.sort(
    (a, b) =>
      statusRank(a.instructionStatus) - statusRank(b.instructionStatus) ||
      a.hostId.localeCompare(b.hostId) ||
      a.scope.localeCompare(b.scope),
  );

  return {
    generatedAt: new Date().toISOString(),
    cwd,
    recipePaths,
    summary: {
      capabilities: summarize(capabilities, (row) => row.type),
      hooks: summarize(hooks, (row) => row.status),
      connectors: summarize(connectors, (row) => row.instructionStatus),
      enrichments: summarize(enrichments, (row) => row.status),
      surfaceAttention: matrix.summary.attention,
    },
    capabilities,
    enrichments,
    hooks,
    connectors,
    surfaceMatrix: matrix,
  };
}
