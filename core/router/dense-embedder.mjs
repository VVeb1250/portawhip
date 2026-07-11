// Phase 4 semantic layer (PLAN.md): a second, meaning-based retrieval channel
// alongside core/sparse-retriever.mjs's lexical one. Margin-gate research
// (docs/router-eval-set.jsonl) proved score-geometry tricks hit a wall - the
// remaining miss (e2e-testing on "use Playwright to test login flow") is a
// paraphrase gap no amount of threshold/margin tuning on lexical scores can
// close. That needs actual semantic similarity.
//
// Zero-setup by design: BAAI/bge-m3 (MIT, 100+ languages including Thai,
// verified live 2026-07-06 - HF reachable from this machine, ~543MB
// quantized ONNX, works with transformers.js's plain feature-extraction
// pipeline with no instruction-prefix ceremony unlike some competitors).
// transformers.js downloads and caches the model itself on first use - no
// install script, no manual model management. Must degrade gracefully when
// the model/network isn't available (PLAN.md Phase 4 spec): every export
// here fails soft (returns [] / null), never throws into the caller.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const MODEL_ID = "Xenova/bge-m3";

// The resolved pipeline, or null until the (slow) first load finishes. Kept
// separate from the load promise so callers can synchronously ask "is it
// ready RIGHT NOW?" without awaiting - the whole point of the non-blocking
// path below.
let extractor = null;
let loadStarted = false;
let unavailable = false;
let loadPromise = null;

// Kicks off the model load in the background (idempotent). The first load is
// slow - measured ~73s cold in the live MCP server (download + ONNX init) -
// so a caller must NEVER sit inside an await on this while serving an
// interactive request: an MCP client times out (~30-60s) long before it
// finishes, drops the connection, and route() becomes uncallable for the
// whole session (found live 2026-07-07: dense-on-by-default silently broke
// the MCP server this way). This returns immediately; the load resolves
// `extractor` whenever it's done.
function startWarm() {
  if (extractor || unavailable || loadStarted) return loadPromise;
  loadStarted = true;
  loadPromise = import("@huggingface/transformers")
    .then(({ pipeline }) => pipeline("feature-extraction", MODEL_ID))
    .then((ex) => {
      extractor = ex;
      return ex;
    })
    .catch(() => {
      unavailable = true;
      return null;
    });
  return loadPromise;
}

// Let a long-lived caller (the MCP server) start the load at startup so the
// ~73s cold load overlaps idle time before the first route() call, instead
// of landing on top of it. Fire-and-forget: returns nothing, never throws.
export function warmDense() {
  startWarm();
}

// Docs are rebuilt fresh per call (core/hybrid-router.mjs's own comment on
// buildCapabilityDocs), so caching on object identity is useless across
// calls - key by id+text instead (same content-hash-cache shape as
// core/eval-harvest.mjs, just keyed by the raw text since collision risk
// over a few hundred short capability descriptions is not worth a hash).
// One process-lifetime cache: a fresh push-hook subprocess gets a fresh
// cache (acceptable - push hook opts out of dense entirely, see
// universal-hook.mjs), while the long-lived MCP server/CLI process reuses
// it across every route() call for the life of the process.
const embeddingCache = new Map();

// Persists embeddingCache to disk so a fresh MCP server process (a new one
// per Claude Code session, not a single long-lived daemon) doesn't re-pay the
// "ready-but-cache-cold" trap on every restart: found live, route() latency
// of 67-104s on the first request after model warm, because 559 capability
// docs were being embedded one-by-one in that request's hot path. Keying is
// still by id+text (embeddingCache's own key), so a changed doc text just
// misses the disk entry instead of serving a stale vector - no separate
// invalidation hash needed.
let diskCachePath = null;
let diskCacheLoaded = false;
let primeInFlight = null;

// Called once at server boot (see server/mcp-server.mjs) so denseRetrieve and
// primeDocCache below know where to read/write the persisted cache. Never
// throws - a caller that skips this just gets the always-worked in-memory-only
// behavior.
export function setDenseCachePath(path) {
  diskCachePath = path;
}

function ensureDiskCacheLoaded() {
  if (diskCacheLoaded || !diskCachePath) return;
  diskCacheLoaded = true;
  try {
    if (!existsSync(diskCachePath)) return;
    const raw = JSON.parse(readFileSync(diskCachePath, "utf8"));
    for (const [key, vector] of Object.entries(raw)) {
      if (!embeddingCache.has(key)) embeddingCache.set(key, vector);
    }
  } catch {
    // Corrupt/unreadable cache file - proceed as if it never existed.
  }
}

function persistDiskCache() {
  if (!diskCachePath) return;
  try {
    mkdirSync(dirname(diskCachePath), { recursive: true });
    writeFileSync(diskCachePath, JSON.stringify(Object.fromEntries(embeddingCache)));
  } catch {
    // Best-effort - a failed write just means next boot re-embeds.
  }
}

// Warms the doc-embedding cache in the BACKGROUND, deliberately called
// separately from warmDense() (which only starts the model load) so a caller
// controls exactly when the (docs, not just model) priming kicks off - here,
// right after loadIndex() at server boot, overlapping the idle time before
// the first real route() call instead of landing inside it. Safe to call
// concurrently/repeatedly: dedupes via primeInFlight, and every doc is a
// no-op past the first time it's embedded (same embeddingCache the request
// path reads).
export async function primeDocCache(docs) {
  ensureDiskCacheLoaded();
  if (primeInFlight) return primeInFlight;
  primeInFlight = (async () => {
    const ready = await startWarm();
    if (!ready) return;
    let embeddedAny = false;
    for (const doc of docs) {
      const key = `${doc.id}::${docText(doc)}`;
      if (embeddingCache.has(key)) continue;
      try {
        embeddingCache.set(key, await embed(ready, docText(doc)));
        embeddedAny = true;
      } catch {
        unavailable = true;
        return;
      }
    }
    if (embeddedAny) persistDiskCache();
  })();
  try {
    await primeInFlight;
  } finally {
    primeInFlight = null;
  }
}

function docText(doc) {
  return [doc.id, (doc.triggers ?? []).join(" "), doc.description ?? ""].join(" ");
}

async function embed(extractor, text) {
  const output = await extractor(text, { pooling: "cls", normalize: true });
  return Array.from(output.data);
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot; // both vectors are already normalized, so dot product == cosine
}

async function embedDoc(extractor, doc) {
  const key = `${doc.id}::${docText(doc)}`;
  if (embeddingCache.has(key)) return embeddingCache.get(key);
  const vector = await embed(extractor, docText(doc));
  embeddingCache.set(key, vector);
  return vector;
}

// Same call shape as sparseRetrieve(docs, query, {k, minScore}) -> {id, doc,
// score}[], so hybrid-router.mjs can treat it as a second, optional channel.
// Score is raw cosine similarity (0..1), never comparable to sparse's
// hundreds/thousands-scale BM25-ish numbers - callers must not mix the two
// on one bar (see hybrid-router.mjs's own dense-specific threshold).
// block=false (the MCP server's tier): if the model isn't warm yet, start the
// background load and return [] immediately - this call is sparse-only, and
// dense silently joins in on a later call once warm. block=true (CLI/eval):
// wait for the load, because those paths want full, deterministic results and
// there's no interactive client to time out.
export async function denseRetrieve(docs, query, { k = 20, minScore = 0.6, block = true } = {}) {
  if (docs.length === 0) return [];
  if (unavailable) return [];
  ensureDiskCacheLoaded();
  if (!extractor) {
    const pending = startWarm();
    if (!block) return [];
    await pending;
    if (!extractor) return [];
  }
  const ready = extractor;

  try {
    const queryVector = await embed(ready, query);
    const scored = [];
    for (const doc of docs) {
      const docVector = await embedDoc(ready, doc);
      const score = cosineSim(queryVector, docVector);
      if (score >= minScore) scored.push({ id: doc.id, doc, score });
    }
    return scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, k);
  } catch (err) {
    unavailable = true;
    return [];
  }
}

// Test-only seams: real model load takes seconds and needs network/disk, so
// unit tests for hybrid-router's fusion logic inject a fake extractor (or
// force the "unavailable"/"still loading" states) instead of paying that cost
// on every run. Never called from production code paths.
export function _setPipelineForTest(fakeExtractor) {
  extractor = fakeExtractor;
  unavailable = false;
  loadStarted = true;
  loadPromise = Promise.resolve(fakeExtractor);
  embeddingCache.clear();
}

export function _forceUnavailableForTest() {
  extractor = null;
  unavailable = true;
  loadStarted = true;
  loadPromise = Promise.resolve(null);
  embeddingCache.clear();
}

// Simulates "load kicked off but not resolved yet" - lets a test exercise the
// non-blocking (block:false) sparse-only path without triggering a real model
// download. loadStarted is pre-set so denseRetrieve won't start a real import;
// the promise deliberately never resolves, so only block:false is safe here.
export function _setPipelinePendingForTest() {
  extractor = null;
  unavailable = false;
  loadStarted = true;
  loadPromise = new Promise(() => {});
  embeddingCache.clear();
}
