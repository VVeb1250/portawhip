# Router: where this stands and what to do next

Handoff written 2026-07-17. Read this, then
[router-eval-holdout.md](router-eval-holdout.md) for the numbers behind every
claim here. Assume nothing in this file without checking that one.

## The short version

The router's abstain problem is solved and was never the router's to solve — the
`route()` instruction filters discussion perfectly (72/72), so the engine only
ever sees real requests. Its remaining problem is that it ranks badly: the right
capability is in the top 3 twice as often as it lands at top 1. Handing the model
5 candidates instead of a verdict closes most of that gap for free (27.5% →
60.8%), and that is now shipped.

## What is live on main

| commit | what |
|---|---|
| `7e62093` | `mcpEnrichmentFrom` / `cliEnrichmentFrom` pure + exported, so the enrichment formula is testable and reusable without a live server |
| `0df4cd3` | two comments in the retrieval path corrected — they described behavior the code does not have |
| `24f628d` | the held-out evaluation |
| `1890ac8` | the R6 measurement |
| `c4a945f` | **R6: `pullHybridThreshold: 150`** — the pull path gets its own bar |
| `88e9af9` | two test families folded into tables |

R6 needed exactly one change. Everything else it depends on already existed:
`k: 5`, the `mode` parameter threaded to `runRoute`, and the
`mode: "candidates"` / "pick or ignore" payload contract.

## What is NOT done

**1. Uncommitted in the working tree: `core/registry/discover.mjs`.**
`extractTriggerSpec` — parses the trigger phrases skill authors already write
("Use when the user asks to X, Y", quoted phrases) instead of frequency-ranking
single words off the description, and recovers acronyms the old
`/[a-z][a-z-]{3,}/` dropped for being under four characters (`to-prd` had no
"prd"). 216 of 521 skills gain a multi-word trigger; 12 gain a `skipWhen`.

It measured **+1 prompt out of 122** and was therefore not shipped. That verdict
was against the OLD contract, where the threshold discarded the improvement
before it could matter. **Re-measure it against R6 before deciding**: the number
it should move is the 70.6% candidate-set reachability, which only became the
binding constraint once R6 landed. Same for the 160-char description truncation
(median installed description is 197; 64% are cut).

**2. The instruction has four unspecified corners.** The gate is perfect today
because five independent agents all guessed the same way, not because it tells
them: query language (all chose English for Thai messages), where "several
distinct actions" splits ("a coin flip" — same phrasing landed on both sides of
one agent's line), whether route covers non-code work, and what to do when the
object is unnamed ("this query is slow. can you look").

**3. Registry data defects, cheap to fix, pure loss today.**
`motion-ui`, `motion-patterns`, `motion-foundations`,
`make-interfaces-feel-better`, `product-lens`, `plan-orchestrate`,
`perl-testing` have an untranslated Japanese placeholder as their description.
Two independent agents had to identify them by name alone. Nothing can retrieve
on text with no content. Also: Stripe ships both an MCP server and a CLI named
`stripe`, and `discoverAll`'s `byId.set` silently keeps whichever came last.

## Things that will mislead you

- **`docs/recognition-router.md` §9 calls step 1 "the single biggest lever".**
  It is not; see above. That document is a design, written before any of it was
  measured. Where it and router-eval-holdout.md disagree, the measurement wins.
- **The push hook is already off** (`pushMode: silent`), and has been. Its 76%
  false-positive rate on discussion describes what it would do if someone set
  `PORTAWHIP_PUSH_MODE=legacy`. It is evidence for a decision already taken, not
  a live bug. If it ever comes back it can only be an amplifier for the certain
  case — 350 is not certain.
- **`docs/router-eval-set.jsonl` scores 1.0 on everything and always will.** It
  is 38 cases written by this repo's author over this repo's author's own
  capabilities, and it runs `mode: "explicit"` — so it does not exercise the pull
  path at all, and R6 cannot regress it. It is a regression guard, not a measure
  of quality. Do not read a green eval as "the router is good".
- **`normalizeConfig` in `core/state/config.mjs` is a hand-written allowlist.**
  A key added to DEFAULTS and to `router.config.yaml` but not to that function
  reaches the router as `undefined`, and unit tests will not catch it because
  they pass options in directly. This shipped broken for one commit. There is now
  a test that walks every routing knob.

## If you re-run the evaluation

The harness lives in the scratchpad, not the repo (it is research code, and it
depends on 194 prompts + 122 labels that are worth more than the scripts). The
method that matters is in router-eval-holdout.md §Method. Two hard-won rules:

- **Subagents must append every few rows.** A session limit killed six agents
  across three separate waves; every one that batched its writes to the end lost
  everything, and every one that appended incrementally kept its work.
- **Never let a model extract text you intend to treat as verbatim.** Three
  independent gatherers caught WebFetch's summarizer corrupting sources: one
  truncation, one paraphrase that inverted a tool's actual semantics, and one
  entirely invented tool table for a README that has none. Verify mechanically —
  raw bytes, literal substring.

## Suggested order

1. Re-measure step 1 and the 160-char truncation **against R6**, on the
   reachability ceiling. This is the only lever left with real headroom.
2. Fix the placeholder descriptions and the `stripe` id collision.
3. Spell out the four instruction corners.
4. Leave the threshold alone. 150 is a measured knee, not a guess: 100 buys 0.9
   points and re-breaks the router's abstention on its own meta-vocabulary.
