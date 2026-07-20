# CLI instruction extraction research — no-LLM ladder

Researched 2026-07-10. Problem: MCP servers self-describe via `tools/list`
(core/enrich.mjs already exploits this), but a CLI binary has no equivalent
API — auto:cli entries stay bare-name and dead on natural queries. Current
enrich.mjs CLI ladder: `--help` first meaningful line → `pip show` (pipx
only). npm-view fallback was tried and dropped: no ecosystem hint from
`mise ls`, so bare names collide ("rust" toolchain vs npm package "rust").

Goal: rich description + natural-language triggers per CLI, deterministic
sources only; embeddings for matching; LLM only as opt-in residue.

## Finding 1 — `mise registry` kills the collision problem

`mise registry` (verified live on this machine, 968 entries) maps every
short name to its backend with the exact package identity:

```
amp        npm:@ampcode/cli
ansible    pipx:ansible
ripgrep    aqua:BurntSushi/ripgrep cargo:ripgrep
ruff       aqua:astral-sh/ruff
rust       core:rust        <- the exact case that broke npm-view: now
                               visibly NOT npm, so no wrong lookup
```

This is the ecosystem hint enrich.mjs's comment says was missing. A tool
resolved through the registry can be safely looked up in its own package
registry — 1:1 identity, no name guessing.

## Finding 2 — package registries: structured description + keywords, one JSON fetch

Keyed by the backend prefix from Finding 1 (all public, no auth, cached
forever in `.hp-state/tool-descriptions.json`):

| backend | source | fields |
|---|---|---|
| `npm:<pkg>` | registry.npmjs.org/`<pkg>` | description, keywords |
| `pipx:<pkg>` | pypi.org/pypi/`<pkg>`/json | summary, keywords |
| `cargo:<crate>` | crates.io/api/v1/crates/`<crate>` | description, keywords, categories |
| `aqua:org/repo`, `github:org/repo`, `go:github.com/…` | GitHub repos API | description, topics |

## Finding 3 — tldr-pages: natural-language usage examples, offline

Single archive: `github.com/tldr-pages/tldr/releases/latest/download/tldr.zip`
(one-time download, then fully offline; also language-specific archives).
Per-command markdown, fixed shape:

```
# rg
> Search for patterns in files using regex…
- Recursively search for a pattern:      <- natural-language example lines
  `rg {{pattern}}`
```

The example description lines ("Recursively search for a pattern") are
exactly the phrasing real prompts use — the best trigger/embedding corpus
available for CLIs, maintained by humans, no AI. Coverage: thousands of
common commands (jq, tmux, tesseract, ruff, rg …).

## Finding 4 — Fig specs / carapace: tier-2 only

withfig/autocomplete has per-subcommand descriptions for 500+ CLIs as TS
objects, but the Fig product repo was archived 2025-03 (Amazon Q took
over) — maintenance risk + TS parsing cost. carapace-bin has broad
completer coverage but spec format is Go-embedded, not cleanly consumable.
Both rejected for v1 (delegate-with-evidence bar not met); revisit only if
a proven gap remains after Findings 1–3.

## Resulting ladder (extends enrich.mjs, all deterministic)

```
identity:   mise ls name ──> mise registry ──> backend:package  (local)
describe:   1. package-registry JSON (Finding 2)         [network, once]
            2. tldr page: one-liner + example lines      [offline zip]
            3. --help first meaningful line (exists)     [local]
               + harvest subcommand names as triggers
            4. pip show (exists, pipx only)              [local]
triggers:   name + subcommands + registry keywords + tldr example lines
matching:   existing dense-embedder.mjs embeds description+examples
            (embedding = matching layer, NOT extraction — deterministic
            text in, similarity out)
residue:    LLM(name) — opt-in flag, cached, expected near-zero: every
            binary has at least --help; custom tools (rtk, icm) get
            --help + subcommand harvest even with no registry presence
```

Provenance recorded per field (`source: "tldr" | "npm" | "help" | …`) so a
wrong description is traceable and evictable — the npm-view lesson.

## Why not LLM-extract / why embeddings don't extract

- Every source above is written by the tool's own author or maintainer
  community — higher factual floor than LLM paraphrase, zero cost, cacheable,
  reproducible (VISION: live-probe, never overclaim; delegate, don't rebuild).
- Embeddings cannot create descriptions (they map existing text to vectors);
  they slot in at the matching layer, which this repo already has
  (dense-embedder.mjs, hybrid router dense channel). Extraction stays
  deterministic; embedding makes the harvested text match natural phrasing.

Sources:
- [tldr pages](https://tldr.sh/)
- [tldr releases (tldr.zip)](https://github.com/tldr-pages/tldr/releases)
- [official tldr.zip location discussion](https://github.com/tldr-pages/tldr/issues/19775)
- [withfig/autocomplete](https://github.com/withfig/autocomplete)
- [withfig/autocomplete-tools](https://github.com/withfig/autocomplete-tools)
- [carapace-bin](https://github.com/carapace-sh/carapace-bin)
- [carapace completers list](https://carapace-sh.github.io/carapace-bin/completers.html)
