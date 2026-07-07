import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Live integration test - spawns the REAL MCP server and calls route() over
// real stdio JSON-RPC, no mocks. The unit tests in core/router.test.mjs inject
// a fake extractor, which by design mocks away the exact thing that broke in
// production: the real BGE-M3 cold load blocking the first route() call for
// ~73s, past the MCP client timeout, leaving route() uncallable for a whole
// session (found live 2026-07-07). A mock can't catch that; only spawning the
// real server with dense enabled (the default) and timing a real call can.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SERVER = join(ROOT, "server", "mcp-server.mjs");
const FEEDBACK_PATH = join(ROOT, ".hp-state", "feedback", "events.jsonl");

// The server logs a real "route" event to this repo's live feedback log.
// Snapshot and restore it so running tests never destroys real dogfood
// history - same discipline as adapters/hooks/universal-hook.test.mjs.
let feedbackBackup;
function snapshotFeedback() {
  feedbackBackup = existsSync(FEEDBACK_PATH) ? readFileSync(FEEDBACK_PATH, "utf8") : null;
}
function restoreFeedback() {
  if (existsSync(FEEDBACK_PATH)) rmSync(FEEDBACK_PATH);
  if (feedbackBackup != null) {
    mkdirSync(dirname(FEEDBACK_PATH), { recursive: true });
    writeFileSync(FEEDBACK_PATH, feedbackBackup);
  }
}

// Spawn the server, do the MCP initialize handshake, then send one route()
// call. Resolves with the round-trip time of the route() call itself (t0 is
// set right before it is sent, so server boot / index load is excluded - we
// are measuring the route() latency the client would feel, which is what the
// non-blocking guarantee is about). MCP stdio framing is newline-delimited
// JSON-RPC.
function callRoute(query, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const srv = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"], cwd: ROOT });
    let buf = "";
    let t0 = null;
    const done = (fn, arg) => {
      clearTimeout(timer);
      srv.kill();
      fn(arg);
    };
    const timer = setTimeout(
      () => done(reject, new Error(`route() did not respond within ${timeoutMs}ms`)),
      timeoutMs,
    );
    srv.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          const ms = Date.now() - t0;
          const payload = JSON.parse(msg.result.content[0].text);
          done(resolve, { ms, result: payload });
        }
      }
    });
    srv.on("error", (err) => done(reject, err));
    const send = (obj) => srv.stdin.write(`${JSON.stringify(obj)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-server-test", version: "1" },
      },
    });
    // Give initialize a moment to be processed before firing the tool call.
    setTimeout(() => {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      t0 = Date.now();
      send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "route", arguments: { query } },
      });
    }, 500);
  });
}

test("mcp-server (live): route() answers fast, never blocking on the dense model cold-load", async () => {
  snapshotFeedback();
  try {
    const { ms, result } = await callRoute("convert this pdf file to markdown text");
    // The regressed behavior blocked ~73s here (dense cold load) and timed the
    // client out. Non-blocking dense must answer in seconds regardless of
    // whether the model is cached, downloading, or unreachable - it returns
    // sparse-only until the background warm finishes. 15s is far below the
    // 73s failure and well under any MCP client timeout, so it cleanly
    // separates healthy from regressed without being flaky on a cold index.
    assert.ok(ms < 15000, `route() took ${ms}ms - expected a fast, non-blocking answer (regression blocked ~73s)`);
    assert.ok(result && typeof result.status === "string", "route() must return a structured decision object");
    assert.ok(Array.isArray(result.results), "decision must carry a results array (possibly empty)");
  } finally {
    restoreFeedback();
  }
});
