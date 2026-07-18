// Semantic families: the "server" level of a two-stage retrieval hierarchy.
//
// MCP-Zero (arXiv 2506.01056) gets its recall from searching a hierarchy rather
// than a flat pool — match the SERVER first (308 of them), then only the tools
// inside the top few (2,797 tools -> ~45 candidates). Its hierarchy is free:
// an MCP tool belongs to exactly one server, stated in the registry.
//
// This registry has no such level. Install namespace is not it: `ecc:` alone
// carries 300+ skills spanning React review, freight logistics and PubMed
// search — a bundle, not a domain. Clustering the capabilities' own embeddings
// is the closest honest equivalent: it groups by what things are ABOUT, which
// is what the server level does in MCP-Zero.
//
// Why this could help at all, stated as a falsifiable claim: a family centroid
// is the mean of many members' phrasings, so it is a broader target than any
// single description. A paraphrase that lands near none of the members
// individually may still land near their mean. If that effect is not real, the
// eval will show no recall gain and this file should be deleted rather than
// tuned.
//
// Deterministic by construction (seeded k-means++), because a clustering that
// shifts between runs makes every A/B measurement meaningless.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { getDocVectors, denseCosine } from "./dense-embedder.mjs";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(vector) {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

function mean(vectors, dim) {
  const out = new Array(dim).fill(0);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) out[i] += vector[i];
  }
  for (let i = 0; i < dim; i += 1) out[i] /= vectors.length || 1;
  return normalize(out);
}

// k-means++ seeding, but with the RNG fixed. Plain random init on 450 points in
// 1024 dimensions produces visibly different clusterings run to run, and an
// eval that cannot reproduce its own baseline cannot referee anything.
function seedCentroids(points, k, rand) {
  const centroids = [points[Math.floor(rand() * points.length)]];
  while (centroids.length < k) {
    const distances = points.map((point) => {
      let best = Infinity;
      for (const centroid of centroids) best = Math.min(best, 1 - denseCosine(point, centroid));
      return best * best;
    });
    const total = distances.reduce((sum, value) => sum + value, 0);
    if (total <= 0) break;
    let target = rand() * total;
    let chosen = points.length - 1;
    for (let i = 0; i < distances.length; i += 1) {
      target -= distances[i];
      if (target <= 0) {
        chosen = i;
        break;
      }
    }
    centroids.push(points[chosen]);
  }
  return centroids;
}

export function kmeans(points, k, { seed = 20260719, iterations = 40 } = {}) {
  if (points.length === 0) return { assignments: [], centroids: [] };
  const clusterCount = Math.max(1, Math.min(k, points.length));
  const dim = points[0].length;
  const rand = mulberry32(seed);
  let centroids = seedCentroids(points, clusterCount, rand);
  let assignments = new Array(points.length).fill(0);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let moved = false;
    for (let i = 0; i < points.length; i += 1) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let c = 0; c < centroids.length; c += 1) {
        const score = denseCosine(points[i], centroids[c]);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = c;
        }
      }
      if (assignments[i] !== bestIndex) {
        assignments[i] = bestIndex;
        moved = true;
      }
    }
    const groups = new Map();
    for (let i = 0; i < points.length; i += 1) {
      if (!groups.has(assignments[i])) groups.set(assignments[i], []);
      groups.get(assignments[i]).push(points[i]);
    }
    // Drop empties rather than re-seeding them: an empty cluster means k was
    // too high for this corpus, and silently reviving it with a random point
    // reintroduces exactly the run-to-run instability the seed exists to stop.
    centroids = [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, members]) => mean(members, dim));
    if (!moved) break;
  }

  // Reassign against the final centroid list so assignments and centroids can
  // never disagree about indices after empty clusters were removed.
  for (let i = 0; i < points.length; i += 1) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let c = 0; c < centroids.length; c += 1) {
      const score = denseCosine(points[i], centroids[c]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = c;
      }
    }
    assignments[i] = bestIndex;
  }
  return { assignments, centroids };
}

function fingerprint(docs, k) {
  const hash = createHash("sha256");
  hash.update(`k=${k}\n`);
  for (const doc of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(`${doc.id}::${(doc.description ?? "").length}\n`);
  }
  return hash.digest("hex").slice(0, 16);
}

export function loadFamilies(path) {
  try {
    if (!path || !existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function saveFamilies(path, payload) {
  try {
    if (!path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload));
  } catch {
    // Best-effort cache; a failed write just means the next run recomputes.
  }
}

// Default family count targets ~9 members each, matching MCP-Zero's corpus
// shape (2,797 tools across 308 servers). Not tuned — a starting point, and
// one of the two knobs (with topFamilies) the eval should sweep.
export function defaultFamilyCount(docCount) {
  return Math.max(2, Math.round(docCount / 9));
}

export async function buildFamilies(docs, { path = null, k = null, block = true, rebuild = false } = {}) {
  const clusterCount = k ?? defaultFamilyCount(docs.length);
  const stamp = fingerprint(docs, clusterCount);
  if (!rebuild) {
    const cached = loadFamilies(path);
    if (cached?.fingerprint === stamp) return cached;
  }

  const vectors = await getDocVectors(docs, { block });
  // Fail soft, exactly like every other dense path here: no vectors means no
  // families, and the caller falls back to flat routing rather than degrading.
  if (vectors.size === 0) return null;

  const usable = docs.filter((doc) => vectors.has(doc.id));
  const points = usable.map((doc) => vectors.get(doc.id));
  const { assignments, centroids } = kmeans(points, clusterCount);

  const members = centroids.map(() => []);
  for (let i = 0; i < usable.length; i += 1) {
    (members[assignments[i]] ??= []).push(usable[i].id);
  }

  const payload = {
    fingerprint: stamp,
    k: centroids.length,
    families: centroids.map((centroid, index) => ({
      index,
      centroid,
      members: members[index] ?? [],
      // Kept for humans reading the cache file and for eval output — never
      // used for scoring.
      label: (members[index] ?? []).slice(0, 4).join(", "),
    })),
  };
  saveFamilies(path, payload);
  return payload;
}

export async function matchFamilies(families, query, { topFamilies = 5, block = true, queryVector = null } = {}) {
  if (!families?.families?.length) return [];
  const vector = queryVector ?? (await (await import("./dense-embedder.mjs")).embedText(query, { block }));
  if (!vector) return [];
  return families.families
    .map((family) => ({ ...family, score: denseCosine(vector, family.centroid) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, topFamilies);
}
