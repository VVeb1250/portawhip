// Surface coverage matrix collector (Phase S0).
//
// Reads surface-matrix.yaml (pure data: which backend owns each read/write
// lane, or a declared gap) and LIVE-PROBES every declared owner so the
// reported status is observed, never asserted (VISION.md: live-probe, never
// overclaim). Owns zero sync logic — each probe just runs the backend's own
// command or the existing discover.mjs function and counts what comes back.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import spawnSync from "cross-spawn";
import * as discover from "../registry/discover.mjs";
import { discoverEmbeddedHooks } from "./discover-hooks.mjs";
import { collectHookLinks } from "../../scripts/link/link-hooks.mjs";
import { collectConnectorLinks } from "../../scripts/link/link-connectors.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const DEFAULT_MATRIX_PATH = join(ROOT, "surface-matrix.yaml");
const PROBE_TIMEOUT_MS = 8000;

const DISCOVER_FNS = {
  mcp: () => discover.discoverMcp(),
  cli: () => discover.discoverCli(),
  skills: () => discover.discoverSkills(),
  commands: () => discover.discoverCommands(),
  agents: () => discover.discoverAgents(),
  embeddedHooks: () => discoverEmbeddedHooks(),
};

export function loadSurfaceMatrix(path = DEFAULT_MATRIX_PATH) {
  const doc = yaml.load(readFileSync(path, "utf8"));
  if (!doc || !Array.isArray(doc.surfaces)) {
    throw new Error(`surface-matrix.yaml: missing "surfaces" list (${path})`);
  }
  return doc.surfaces;
}

function commandResolves(argv, cwd) {
  const [cmd, ...args] = argv;
  // Prefer a repo-local bin, matching the resolution the sync scripts use.
  const suffix = process.platform === "win32" ? ".cmd" : "";
  const local = join(cwd, "node_modules", ".bin", `${cmd}${suffix}`);
  const command = existsSync(local) ? local : cmd;
  const result = spawnSync.sync(command, args, { cwd, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  // status 0 = ran fine. ENOENT (error) = backend not installed.
  if (result.error) return { covered: false, detail: result.error.code || "not found" };
  return { covered: result.status === 0, detail: `exit ${result.status ?? "?"}` };
}

async function probeDiscover(fn, cwd) {
  const runner = DISCOVER_FNS[fn];
  if (!runner) return { covered: false, detail: `unknown discover fn "${fn}"` };
  try {
    const items = await runner();
    const count = Array.isArray(items) ? items.length : 0;
    return { covered: true, count, detail: `${count} found` };
  } catch (error) {
    return { covered: false, detail: `probe error: ${error.message}` };
  }
}

async function probeLink(kind) {
  const collect = kind === "link-hooks" ? collectHookLinks : collectConnectorLinks;
  const statusField = kind === "link-hooks" ? "status" : "instructionStatus";
  const linkedValues = new Set(["linked"]);
  let linked = 0;
  let total = 0;
  for (const scope of ["project", "global"]) {
    const { rows } = await collect({ command: "status", scope });
    for (const row of rows) {
      total += 1;
      if (linkedValues.has(row[statusField])) linked += 1;
    }
  }
  return { covered: linked > 0, count: linked, detail: `${linked}/${total} host rows linked` };
}

async function probeDirection(direction, { cwd, heavy }) {
  if (!direction) return { status: "undeclared", detail: "no direction declared" };
  if (!direction.owner) {
    return { status: direction.gap ?? "missing", owner: null, detail: direction.note ?? "no lane" };
  }
  // Owner present but a gap declared with no probe = a known-partial lane
  // (e.g. agents write via ai-config-sync covers only claude<->codex). The
  // gap is the honest status; owner is informational.
  if (direction.gap && !direction.probe) {
    return { status: direction.gap, owner: direction.owner, detail: direction.note ?? direction.gap };
  }
  const probe = direction.probe ?? { kind: "none" };
  if (probe.heavy && !heavy) {
    return { status: "declared", owner: direction.owner, detail: "count skipped (run with heavy=true)" };
  }
  let result;
  if (probe.kind === "command") result = commandResolves(probe.argv, cwd);
  else if (probe.kind === "discover") result = await probeDiscover(probe.fn, cwd);
  else if (probe.kind === "link-hooks" || probe.kind === "link-connectors") result = await probeLink(probe.kind);
  else result = { covered: false, detail: `unknown probe kind "${probe.kind}"` };

  return {
    status: result.covered ? "covered" : "backend-missing",
    owner: direction.owner,
    count: result.count,
    detail: result.detail,
  };
}

export async function collectSurfaceMatrix({ cwd = process.cwd(), heavy = false, path } = {}) {
  const surfaces = loadSurfaceMatrix(path);
  const rows = [];
  for (const surface of surfaces) {
    rows.push({
      id: surface.id,
      label: surface.label ?? surface.id,
      read: await probeDirection(surface.read, { cwd, heavy }),
      write: await probeDirection(surface.write, { cwd, heavy }),
    });
  }
  const attention = rows.filter(
    (row) => ["missing", "backend-missing"].includes(row.read.status) || ["missing", "backend-missing"].includes(row.write.status),
  );
  return {
    generatedAt: new Date().toISOString(),
    heavy,
    rows,
    summary: {
      surfaces: rows.length,
      attention: attention.map((row) => row.id),
    },
  };
}
