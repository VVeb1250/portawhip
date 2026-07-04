import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildCapabilityDocs } from "./capability-docs.mjs";
import { capabilityKind } from "./capability-kind.mjs";
import { tokenize } from "./tokenize.mjs";

const GRAPH_STOPWORDS = new Set([
  "agent",
  "agents",
  "code",
  "data",
  "file",
  "files",
  "project",
  "task",
  "tool",
  "tools",
  "use",
  "user",
  "workflow",
]);

function tokenSet(doc) {
  const tokens = new Set(tokenize(doc.text).filter((token) => !GRAPH_STOPWORDS.has(token)));
  for (const token of tokenize(doc.id)) tokens.add(token);
  return tokens;
}

function overlapScore(left, right) {
  let score = 0;
  for (const token of left.tokens) {
    if (right.tokens.has(token)) score += 1;
  }
  const rightId = right.doc.id.toLowerCase();
  const leftId = left.doc.id.toLowerCase();
  if (String(left.doc.text ?? "").toLowerCase().includes(rightId)) score += 4;
  if (String(right.doc.text ?? "").toLowerCase().includes(leftId)) score += 4;
  return score;
}

function edgeType(from, to) {
  const fromKind = capabilityKind(from.type);
  const toKind = capabilityKind(to.type);
  if (fromKind === "skill" && toKind === "tool") return "skill_uses_tool";
  if (fromKind === "tool" && toKind === "skill") return "tool_supports_skill";
  if (fromKind === "skill" && toKind === "skill") return "related_skill";
  return "related_tool";
}

export function compileCapabilityGraph(
  index,
  { maxEdgesPerNode = 3, minScore = 3 } = {},
) {
  const docs = buildCapabilityDocs(index);
  const prepared = docs.map((doc) => ({ doc, tokens: tokenSet(doc) }));
  const edges = [];

  for (const source of prepared) {
    const scored = [];
    for (const target of prepared) {
      if (source.doc.id === target.doc.id) continue;
      const score = overlapScore(source, target);
      if (score >= minScore) {
        scored.push({
          from: source.doc.id,
          to: target.doc.id,
          type: edgeType(source.doc, target.doc),
          weight: Math.min(1, Number((score / 8).toFixed(3))),
          score,
        });
      }
    }
    scored
      .sort((a, b) => b.score - a.score || a.to.localeCompare(b.to))
      .slice(0, maxEdgesPerNode)
      .forEach(({ score, ...edge }) => edges.push(edge));
  }

  return {
    generatedAt: new Date().toISOString(),
    nodeCount: docs.length,
    edgeCount: edges.length,
    edges,
  };
}

export function writeCapabilityGraph(path, graph) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(graph, null, 2)}\n`);
}
