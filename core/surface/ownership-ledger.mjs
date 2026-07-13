import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function contentHash(content) {
  return createHash("sha256").update(String(content)).digest("hex");
}

export function claimOwnership(ledger = {}, { path, writer, content, scope }) {
  if (!path || !writer) throw new Error("ownership claims require path and writer");
  const current = ledger.paths?.[path];
  if (current && current.writer !== writer) {
    throw new Error(`${path} is owned by ${current.writer}; ${writer} cannot claim it`);
  }
  return {
    ...ledger,
    version: 1,
    paths: {
      ...(ledger.paths ?? {}),
      [path]: { writer, hash: contentHash(content), ...(scope ? { scope } : {}) },
    },
  };
}

export function verifyOwnedContent(ledger = {}, { path, writer, content }) {
  const claim = ledger.paths?.[path];
  if (!claim) return { status: "unowned", path, writer };
  if (claim.writer !== writer) {
    return { status: "non-owner", path, writer, owner: claim.writer };
  }
  const actualHash = contentHash(content);
  return {
    status: actualHash === claim.hash ? "clean" : "drift",
    path,
    writer,
    expectedHash: claim.hash,
    actualHash,
  };
}

export function readOwnershipLedger(path) {
  if (!existsSync(path)) return { version: 1, paths: {} };
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeOwnershipLedger(path, ledger) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`);
  renameSync(temporary, path);
}
