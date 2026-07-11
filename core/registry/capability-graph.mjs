import { existsSync, readFileSync } from "node:fs";

export function loadCapabilityGraph(path) {
  if (!path || !existsSync(path)) return { edges: [] };
  const graph = JSON.parse(readFileSync(path, "utf8"));
  return { edges: Array.isArray(graph.edges) ? graph.edges : [] };
}

function edgeWeight(edge) {
  return typeof edge.weight === "number" ? edge.weight : 1;
}

function buildNeighborMap(graph) {
  const neighbors = new Map();
  for (const edge of graph.edges ?? []) {
    if (!edge.from || !edge.to) continue;
    const list = neighbors.get(edge.from) ?? [];
    list.push({ id: edge.to, type: edge.type ?? "related", weight: edgeWeight(edge) });
    neighbors.set(edge.from, list);
  }
  return neighbors;
}

export function expandWithGraph(candidates, docs, graph, { boost = 0.25 } = {}) {
  if (!candidates.length || !graph?.edges?.length) return candidates;

  const docsById = new Map(docs.map((doc) => [doc.id, doc]));
  const neighbors = buildNeighborMap(graph);
  const merged = new Map(candidates.map((candidate) => [candidate.id, { ...candidate }]));

  for (const candidate of candidates) {
    for (const neighbor of neighbors.get(candidate.id) ?? []) {
      const doc = docsById.get(neighbor.id);
      if (!doc) continue;
      const score = candidate.score * boost * neighbor.weight;
      const current = merged.get(neighbor.id);
      if (current) {
        current.graphSeen = true;
      } else {
        merged.set(neighbor.id, {
          id: neighbor.id,
          doc,
          score,
          graphBoosted: true,
          graphSource: candidate.id,
          graphEdgeType: neighbor.type,
        });
      }
    }
  }

  return [...merged.values()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
