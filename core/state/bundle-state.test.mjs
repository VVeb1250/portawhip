import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listCatalog,
  readActiveSelection,
  resolveRecipePaths,
  writeActiveSelection,
} from "./bundle-state.mjs";
import { buildIndex, isDiscovered, mergeRawEntries } from "../registry/registry.mjs";

function tmpProject() {
  return mkdtempSync(join(tmpdir(), "harness-bundle-"));
}

function writeRecipe(path, entries) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    entries
      .map((e) => `- id: ${e.id}\n  type: ${e.type}\n  source: ${e.source}\n  route:\n    triggers: ["${e.trigger}"]\n    description: "${e.description}"\n    when: [user_prompt]\n    inject: hint\n`)
      .join(""),
  );
}

test("bundle-state: default selection (no file yet) is nothing selected", () => {
  const root = tmpProject();
  try {
    assert.deepEqual(readActiveSelection(root), { foundry: false, roles: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-state: default selection resolves to only the project's own recipe.yaml (no regression)", () => {
  const root = tmpProject();
  try {
    writeFileSync(join(root, "recipe.yaml"), "- id: x\n  type: cli\n  source: x\n");
    const paths = resolveRecipePaths(root, readActiveSelection(root));
    assert.deepEqual(paths, [join(root, "recipe.yaml")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-state: write/read selection round-trips and dedupes roles", () => {
  const root = tmpProject();
  try {
    writeActiveSelection(root, { foundry: true, roles: ["secure", "secure", "coding"] });
    const selection = readActiveSelection(root);
    assert.equal(selection.foundry, true);
    assert.deepEqual(selection.roles, ["secure", "coding"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-state: resolveRecipePaths orders foundry -> roles -> project recipe.yaml, skipping missing files", () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, "recipes", "roles"), { recursive: true });
    writeFileSync(join(root, "recipes", "foundry.yaml"), "- id: f\n  type: cli\n  source: f\n");
    writeFileSync(join(root, "recipes", "roles", "secure.yaml"), "- id: s\n  type: cli\n  source: s\n");
    writeFileSync(join(root, "recipe.yaml"), "- id: u\n  type: cli\n  source: u\n");

    const paths = resolveRecipePaths(root, { foundry: true, roles: ["secure", "does-not-exist"] });
    assert.deepEqual(paths, [
      join(root, "recipes", "foundry.yaml"),
      join(root, "recipes", "roles", "secure.yaml"),
      join(root, "recipe.yaml"),
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-state: listCatalog reads manifest descriptions and entry ids from disk", () => {
  const root = tmpProject();
  try {
    mkdirSync(join(root, "recipes", "roles"), { recursive: true });
    writeFileSync(join(root, "recipes", "manifest.yaml"), 'foundry:\n  description: "core"\nroles:\n  secure:\n    description: "sec role"\n');
    writeFileSync(join(root, "recipes", "foundry.yaml"), "- id: f\n  type: cli\n  source: f\n");
    writeFileSync(join(root, "recipes", "roles", "secure.yaml"), "- id: s1\n  type: cli\n  source: s1\n- id: s2\n  type: cli\n  source: s2\n");

    const { foundry, roles } = listCatalog(root);
    assert.equal(foundry.description, "core");
    assert.deepEqual(foundry.entryIds, ["f"]);
    assert.equal(roles.length, 1);
    assert.equal(roles[0].id, "secure");
    assert.equal(roles[0].description, "sec role");
    assert.deepEqual(roles[0].entryIds, ["s1", "s2"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("bundle-state: catalog is empty-safe when recipes/ doesn't exist yet", () => {
  const root = tmpProject();
  try {
    const { foundry, roles } = listCatalog(root);
    assert.equal(foundry, null);
    assert.deepEqual(roles, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry: mergeRawEntries lets a later path win on id collision (user > role > foundry precedence)", () => {
  const root = tmpProject();
  try {
    const foundryPath = join(root, "foundry.yaml");
    const userPath = join(root, "recipe.yaml");
    writeFileSync(foundryPath, '- id: shared\n  type: cli\n  source: from-foundry\n  route:\n    triggers: ["a"]\n    description: "foundry version"\n');
    writeFileSync(userPath, '- id: shared\n  type: cli\n  source: from-user\n  route:\n    triggers: ["b"]\n    description: "user override"\n');

    const merged = mergeRawEntries([foundryPath, userPath]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, "from-user");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registry: buildIndex composes multiple recipe files into one curated set", async () => {
  const root = tmpProject();
  try {
    const foundryPath = join(root, "foundry.yaml");
    const rolePath = join(root, "role.yaml");
    writeRecipe(foundryPath, [{ id: "tool-a", type: "cli", source: "tool-a", trigger: "alpha task", description: "alpha" }]);
    writeRecipe(rolePath, [{ id: "tool-b", type: "cli", source: "tool-b", trigger: "beta task", description: "beta" }]);

    const index = await buildIndex([foundryPath, rolePath], { discover: false });
    const ids = index.entries.map((e) => e.id).sort();
    assert.deepEqual(ids, ["tool-a", "tool-b"]);
    assert.ok(index.entries.every((e) => e.origin === "recipe"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Regression: mise keys a backend-qualified install (e.g. "pipx:markitdown")
// by that full string, not the clean id a recipe entry chooses ("markitdown")
// - found live 2026-07-05 when route() stayed silent for an actually-installed
// markitdown because the gate only compared entry.id against discovery.
test("registry: isDiscovered matches on entry.source when discovery's id differs (backend-qualified sources)", () => {
  const entry = { id: "markitdown", source: "pipx:markitdown" };
  const discovered = [{ id: "pipx:markitdown", source: "pipx:markitdown", type: "cli" }];
  assert.equal(isDiscovered(entry, discovered), true);
});

test("registry: isDiscovered still matches the plain case (id === source)", () => {
  const entry = { id: "ast-grep", source: "ast-grep" };
  const discovered = [{ id: "ast-grep", source: "ast-grep", type: "cli" }];
  assert.equal(isDiscovered(entry, discovered), true);
});

test("registry: isDiscovered returns false when neither id nor source is present", () => {
  const entry = { id: "gitleaks", source: "gitleaks" };
  const discovered = [{ id: "ast-grep", source: "ast-grep", type: "cli" }];
  assert.equal(isDiscovered(entry, discovered), false);
});

test("registry: buildIndex with a single string path still works exactly as before (backward compat)", async () => {
  const root = tmpProject();
  try {
    const path = join(root, "recipe.yaml");
    writeRecipe(path, [{ id: "solo", type: "cli", source: "solo", trigger: "solo task", description: "solo" }]);
    const index = await buildIndex(path, { discover: false });
    assert.deepEqual(index.entries.map((e) => e.id), ["solo"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
