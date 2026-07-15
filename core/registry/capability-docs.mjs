import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function uniq(values) {
  return [...new Set(values.filter((v) => typeof v === "string" && v.trim() !== ""))];
}

function skillFileFor(path) {
  if (!path || !existsSync(path)) return null;
  const stat = statSync(path);
  if (stat.isFile()) return path;
  if (!stat.isDirectory()) return null;
  const skillFile = join(path, "SKILL.md");
  return existsSync(skillFile) ? skillFile : null;
}

function parseFrontmatter(text) {
  const match = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!field) continue;
    data[field[1]] = field[2].replace(/^["']|["']$/g, "").trim();
  }
  return { data, body: text.slice(match[0].length) };
}

function extractHeadings(body, max = 12) {
  const headings = [];
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const match = line.match(/^#{1,3}\s+(.+)$/);
    if (!match) continue;
    headings.push(match[1].replace(/\s+#$/, "").trim());
    if (headings.length >= max) break;
  }
  return headings;
}

function sectionByHeading(body, patterns, maxChars = 1200) {
  const lines = String(body ?? "").split(/\r?\n/);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const heading = lines[i].match(/^(#{1,3})\s+(.+)$/);
    if (!heading) continue;
    const title = heading[2].toLowerCase();
    if (!patterns.some((pattern) => pattern.test(title))) continue;
    const level = heading[1].length;
    const collected = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextHeading = lines[j].match(/^(#{1,3})\s+/);
      if (nextHeading && nextHeading[1].length <= level) break;
      collected.push(lines[j]);
    }
    const text = collected
      .join("\n")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[`*_>\[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n").slice(0, maxChars);
}

function readSkillMetadata(path) {
  try {
    const skillFile = skillFileFor(path);
    if (!skillFile) return {};
    const text = readFileSync(skillFile, "utf8");
    const { data, body } = parseFrontmatter(text);
    return {
      skillFile,
      frontmatterName: data.name ?? null,
      frontmatterDescription: data.description ?? null,
      headings: extractHeadings(body),
      activation: sectionByHeading(body, [
        /when to use/,
        /when to activate/,
        /activation/,
        /use when/,
        /trigger/,
        /routing/,
      ]),
      related: sectionByHeading(body, [/related/, /coordination/, /handoff/], 600),
    };
  } catch {
    return {};
  }
}

export function pointerFor(entry) {
  // Every type:cli entry in this project installs via mise (scripts/load.mjs's
  // loadCli always dispatches through it), so a bare command name only
  // resolves if the invoking shell happens to have `mise activate` wired in
  // - not guaranteed, and not something this project can set up on someone
  // else's machine (VISION.md: cross-OS by detection, not a per-machine
  // setup step). `mise exec --` always works, on every OS, with zero setup.
  // Found live 2026-07-05: a bundle-installed CLI worked via mise but the
  // bare command was "not found" in a shell with no mise activation.
  if (entry.type === "cli" && entry.source) return `mise exec -- ${entry.source}`;
  return entry.path ?? entry.source ?? null;
}

export function buildCapabilityDocs(index) {
  return index.entries
    .filter((entry) => entry.route)
    .map((entry) => {
      const triggers = Array.isArray(entry.route.triggers) ? entry.route.triggers : [];
      const metadata = entry.type === "skill" ? readSkillMetadata(entry.path) : {};
      const fields = {
        id: entry.id,
        type: entry.type,
        origin: entry.origin,
        pointer: pointerFor(entry),
        source: entry.source ?? null,
        path: entry.path ?? null,
        description: entry.route.description,
        triggers,
        skipWhen: Array.isArray(entry.route.skipWhen) ? entry.route.skipWhen : [],
        frontmatterName: metadata.frontmatterName ?? null,
        frontmatterDescription: metadata.frontmatterDescription ?? null,
        headings: metadata.headings ?? [],
        activation: metadata.activation ?? null,
        related: metadata.related ?? null,
        readyMarker: entry.route.readyMarker ?? null,
        readyHint: entry.route.readyHint ?? null,
        action: entry.route.action ?? null,
      };
      const text = uniq([
        entry.id,
        entry.type,
        entry.origin,
        entry.route.description,
        ...triggers,
        entry.source,
        entry.path,
        metadata.frontmatterName,
        metadata.frontmatterDescription,
        ...(metadata.headings ?? []),
        metadata.activation,
        metadata.related,
      ]).join("\n");
      return { ...fields, text };
    });
}
