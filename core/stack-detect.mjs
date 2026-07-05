// Router gap found in review: nothing in the scoring pipeline knows what
// language/stack the CALLING project actually is, even though the eval
// harness's own failures are exactly cross-language mismatches (cpp-testing
// outscoring python-testing on a literal "pytest" prompt). Detecting the
// project's real stack from marker files and turning it into a per-id
// score factor is a cheap, deterministic, zero-dependency fix — reuses the
// same factor-multiplier seam core/feedback.mjs already established.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const STACK_MARKERS = {
  python: ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"],
  javascript: ["package.json"],
  go: ["go.mod"],
  rust: ["Cargo.toml"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts"],
  ruby: ["Gemfile"],
  php: ["composer.json"],
  swift: ["Package.swift"],
  dart: ["pubspec.yaml"],
  cpp: ["CMakeLists.txt"],
};

const STACK_EXTENSIONS = {
  csharp: [".csproj", ".sln"],
};

// What language a capability doc is ABOUT, inferred from its id — this
// ecosystem consistently names language-scoped skills/agents "<lang>-...."
// (python-testing, cpp-reviewer, golang-patterns) or names a framework that
// implies one language (django-tdd implies python, quarkus-patterns implies
// java). Only doc ids that hit one of these keywords are touched at all;
// generic entries (code-review, tdd-workflow, git-workflow) are never
// boosted or demoted by stack detection.
const DOC_STACK_KEYWORDS = {
  python: ["python", "django", "flask", "fastapi", "pytest"],
  javascript: ["javascript", "typescript", "react", "vue", "node", "nextjs", "nuxt", "angular", "bun", "vite"],
  go: ["golang", "go-"],
  rust: ["rust", "cargo"],
  java: ["java", "spring", "quarkus", "jpa"],
  ruby: ["ruby", "rails"],
  php: ["php", "laravel"],
  swift: ["swift"],
  dart: ["dart", "flutter"],
  cpp: ["cpp"],
  csharp: ["csharp", "dotnet"],
  kotlin: ["kotlin"],
};

export function detectStack(cwd) {
  const detected = new Set();
  for (const [lang, markers] of Object.entries(STACK_MARKERS)) {
    if (markers.some((marker) => existsSync(join(cwd, marker)))) detected.add(lang);
  }
  let entries = [];
  try {
    entries = readdirSync(cwd);
  } catch {
    entries = [];
  }
  for (const [lang, exts] of Object.entries(STACK_EXTENSIONS)) {
    if (entries.some((name) => exts.some((ext) => name.endsWith(ext)))) detected.add(lang);
  }
  return detected;
}

function docStacks(id) {
  const idLower = id.toLowerCase();
  const stacks = new Set();
  for (const [lang, keywords] of Object.entries(DOC_STACK_KEYWORDS)) {
    if (keywords.some((kw) => idLower.includes(kw))) stacks.add(lang);
  }
  return stacks;
}

// Precision-first (PLAN.md: "precision over recall") — only ever touches
// docs that are unambiguously about a specific stack, and only ever acts
// once at least one stack was actually detected in cwd. An unrecognized or
// empty project must not demote anything.
export function stackFactors(index, cwd, { boost = 1.3, demote = 0.4 } = {}) {
  const factors = new Map();
  const detected = detectStack(cwd);
  if (detected.size === 0) return factors;
  for (const entry of index.entries) {
    const stacks = docStacks(entry.id);
    if (stacks.size === 0) continue;
    const overlaps = [...stacks].some((lang) => detected.has(lang));
    factors.set(entry.id, overlaps ? boost : demote);
  }
  return factors;
}

export function combineFactors(...maps) {
  const combined = new Map();
  for (const map of maps) {
    for (const [id, value] of map) {
      combined.set(id, (combined.get(id) ?? 1.0) * value);
    }
  }
  return combined;
}
