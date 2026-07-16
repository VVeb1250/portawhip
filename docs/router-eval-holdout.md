# Held-out router evaluation (2026-07-17)

What the router actually does for users who are not its author, measured instead
of waited for. 194 prompts across 12 disciplines and 2 languages, written by
people who had never seen this registry, scored against blind ground-truth
labels.

Companion to [recognition-router.md](recognition-router.md) (the design this
tests) and [intent-gate-bakeoff.md](intent-gate-bakeoff.md) (whose held-out
discipline this follows). **Several claims in those documents are falsified
below.** Where they disagree with this file, this file has the measurement.

## Why

`docs/router-eval-set.jsonl` reports precision@1, recall@3, MRR and
abstain-accuracy all at 1.0. That set has 38 cases, written by the router's
author, over the author's own installed capabilities. It answers "does the
router still do what I tuned it to do", not "does the router work for a
stranger in another discipline". The plan was to merge, dogfood, and read the
trust loop after 1–2 weeks. Measuring directly is faster and does not depend on
one person's usage.

## Method

- **Prompts.** 8 agents (dev domains) + 4 agents (non-dev/vertical) each wrote
  realistic user messages with **no access to this repository** — no recipe.yaml,
  no capability list, no `route()`. Each produced task requests (**group A**, the
  user wants work done) and hard negatives (**group B**, same jargon, but the
  user is only talking). Every domain includes Thai, as users really type it.
  Result: 194 prompts — 122 A, 72 B — over frontend, backend, data/ML, devops,
  security, docs/research, mobile, testing, design/marketing, PM/finance,
  healthcare/science, logistics/trading/network.
- **Registry.** The author's 594 installed capabilities plus 51 built from real
  published MCP/CLI metadata (verbatim tool names and descriptions gathered from
  npm/GitHub/official docs), pushed through **production's own enrichment
  formulas** (`mcpEnrichmentFrom` / `cliEnrichmentFrom`) and stamped
  `origin:"auto:mcp"`/`"auto:cli"`. Not a recipe.yaml fixture: recipe entries get
  `origin:"recipe"`, a lower threshold and the "required" tier, so a curated
  fixture would flatter itself. Total 645.
- **Labels.** Separate agents, given the full inventory and the group A prompts
  but **never the router's output**, named the one capability a competent
  engineer would reach for — or `null` when nothing installed fits. 102 of 122
  answerable, 20 honestly null.
- **Both paths, swept.** Same prompts, same labels, four thresholds.

## The two paths are different products

```
PUSH (hooks)   raw user message ──────────────────────────────► router
PULL (MCP)     raw user message ─► assistant applies the ─► query ─► router
                                   route() instruction
```

The instruction says "state only the positively requested action and its direct
object; do not copy the raw prompt". So on the pull path the router never sees
chat — only a distilled action, and only when the assistant decided there was
one. Feeding raw prompts to the router measures the hook, not the MCP tool.

## Result 1 — the instruction is a perfect gate

Agents simulating an assistant under the real CLAUDE.md block and the real
`route` tool description, on all 194 prompts, shuffled and unlabelled:

| | |
|---|---|
| group B (discussion) that correctly did **not** call route | **72/72** |
| group A (real requests) that correctly **did** call route | **122/122** |

No false positives, no false negatives, across 12 disciplines and 2 languages.
**The router does not need to solve abstention on the pull path — the
instruction already has.** Confirmed downstream: group B false-positive rate is
0% at every threshold tested, because those prompts never reach the router.

## Result 2 — the same router on raw prompts is unusable

| path | bar | group A top-3 | group B false positives |
|---|---|---|---|
| **pull** | 350 (production) | 49% | **0/72 (0%)** |
| **push** | 350 (production) | 52.9% | **55/72 (76.4%)** |

The push hook fires on **76% of pure discussion** at today's threshold. Not a
tuning gap: a chatty message shares dozens of function words with dozens of
documents, and the router's stopword list covers 28 words. Expanding it to full
conversational English was tried — abstain accuracy moves 26% → 39%, still
unusable, while costing real matches. Raw chat contains no requested action to
retrieve on. No lexical fix reaches this.

## Result 3 — the threshold trade, with labels

Pull path. `noise` = the router fired when the blind labeller said nothing
installed fits; `silence` = it correctly stayed quiet on those same 20.

| bar | top-1 | top-3 | wrong | miss | noise (of 20) | correct silence (of 20) | group B FP |
|---|---|---|---|---|---|---|---|
| **350** (production) | 27.5% | 49% | 19 | **33** | **5** | **15** | 0% |
| 200 | 33.3% | 58.8% | 26 | 16 | 13 | 7 | 0% |
| 150 | 32.4% | 61.8% | 29 | 10 | 15 | 5 | 0% |
| **100** | **34.3%** | **62.7%** | 35 | **3** | **19** | **1** | 0% |

350 → 100 buys **+14 correct (top-3) and −30 misses**, and costs **+16 wrong,
+14 noise, and the ability to say "nothing fits" (15/20 → 1/20)**.

Measured before the labels existed, this looked free: "something surfaced" rose
61% → 97%. It is not free. *Surfaced* is not *correct*, and only labels can tell
them apart. **Do not lower the threshold on today's contract.**

## Result 4 — retrieval finds it; ranking loses it

**top-3 is roughly double top-1 at every threshold** (34.3% vs 62.7% at bar 100).
The right capability is usually already in the candidate set and simply not
first. That is not a recall problem, and no threshold move fixes it.

It is the exact gap [recognition-router.md](recognition-router.md)'s R6 exists to
close: return the candidates, let the model pick. It also reprioritises the
threshold work — a lower bar is only affordable once noise is cheap, which it
becomes precisely when the model, not the router, makes the final call.

**Ship R6 first. Then re-run this sweep.**

## Result 5 — step 1 (trigger-spec enrichment) is not the lever

recognition-router.md §9 calls trigger-spec docs "the single biggest lever".
Measured: **+1 prompt out of 122** (117 → 118 surfaced at bar 100; 61.5% → 60.7%
at bar 350).

The extraction is genuinely better — parsing the trigger phrases skill authors
already wrote gives `security-review` {"adding authentication", "handling user
input"} instead of {skill, adding, handling}, and recovers acronyms
(`to-prd` finally has "prd") that the old `/[a-z][a-z-]{3,}/` silently dropped
for being under four characters. 216 of 521 skills gain a multi-word trigger, 12
gain a `skipWhen` from their own text. None of it matters while the threshold
discards the result anyway. Not shipped; revisit when R6 can use the phrases.

## Result 6 — the registry skews to its owner

Group A, share where the router surfaced anything, pull path at production bar:

| backend | docs | logitrade | devops | security | frontend | testing | data | pmfin | healthsci | mobile | design/marketing |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 100% | 80% | 75% | 70% | 70% | 60% | 60% | 50% | 50% | 50% | 50% | **20%** |

The router works best in the domain its owner works in and worst outside it.
This is what "it is only my config" looks like as a number.

**Language is not a factor**: Thai 60% vs English 62%. The assistant translates
the action into English at gate 1, so the registry's English-only vocabulary
never becomes the user's problem. Nothing in the instructions tells it to do
that — see the gaps below.

## Result 7 — instruction gaps (all five simulating agents, independently)

The gate is perfect, but three things are decided by inference, not instruction:

1. **Query language is unspecified.** Every agent chose English and every one
   flagged it: *"nothing in the instructions says which language the query should
   be in"*. It works today because they all guessed the same way.
2. **"Several distinct actions" has no boundary.** *"the instructions don't
   define where one action ends and the next begins"* — one agent split
   "fix it and add a test" into two calls while treating "dig through the crash
   and patch it" as one, and called its own line *"a coin flip"*.
3. **Non-code work is unaddressed.** *"the instructions give no signal about
   whether route is meant for non-code work at all"* — reasonable, since half the
   registry is non-code.
4. Minor: nothing says what to do when the object is unnamed ("this query is
   slow. can you look").

## Result 8 — registry data defects found in passing

- **Unroutable descriptions.** `motion-ui`, `motion-patterns`,
  `motion-foundations`, `make-interfaces-feel-better`, `product-lens`,
  `plan-orchestrate`, `perl-testing` carry an untranslated placeholder
  ("日本語翻訳：このファイルは… 翻訳が必要です") as their description. No
  retrieval can match text that has no content.
- **Near-duplicate capabilities.** Five overlapping security-review entries
  (`security-review` skill, `security-reviewer` agent, `security-auditor`, …);
  `to-prd`/`prp-prd`/`plan-prd`; `e2e-testing`/`e2e-runner`;
  `refactor-cleaner`/`refactor-clean`; `benchmark`/`hyperfine`;
  `network-config-validation`/`network-config-reviewer`/`cisco-ios-patterns`.
  **This is why top-1 understates the router** and why top-3 is the number to
  read.
- **Cross-kind id collision.** Stripe ships both an MCP server and a CLI named
  `stripe`. `discoverAll` resolves it silently (`byId.set` = last wins); the
  sparse index would throw on the duplicate.
- **Description truncation.** Skill descriptions are cut to 160 chars; the median
  installed description is 197 and 64% exceed the cut. The indexed
  `description` field (sparse boost 2) is losing its tail for most skills.

## What this changes

1. **Cut the push hook, or re-scope it.** 76% false-positive on discussion at the
   production threshold. If it stays, it cannot be a suggester; it can only be an
   amplifier for cases that are certain, and 350 is not certain.
2. **Build R6 (recognition set) next**, not step 1 and not a threshold change.
   The top-1/top-3 gap is the largest measured, and it is the one R6 targets.
3. **Then re-run this sweep.** A lower bar becomes affordable exactly when the
   model does the picking.
4. **Fix the placeholder descriptions and the id collision** — cheap, and they
   are pure loss today.
5. **Spell out the four instruction gaps** before more assistants have to guess.

## Honest limits

- **Prompt-writer agents saw installed skill names in their own system prompt.**
  They were told not to echo them and did not, but "held-out" is held-out from
  the registry's *triggers*, not from every mention of a skill name.
- **Ground truth is one blind labeller per prompt**, on descriptions truncated to
  85 chars for budget. Several labels rest on partial text, and the labellers
  said so. 75 of 122 are high-confidence.
- **Fixture metadata is real but not fully verified.** 39 of 57 entries were
  mechanically confirmed verbatim against their cited source; 0 were fabricated;
  16 are "partial" because the gatherer legitimately took tool *names* from a
  README and tool *descriptions* from the registering source file, while the
  schema recorded only one URL. Two sources were unreachable.
- **WebFetch's summarizer corrupts source text.** Three gatherers independently
  caught it: one truncated description, one paraphrase that inverted a tool's
  actual semantics, and one **wholly invented tool table** for a README that has
  none. Anything gathered through it without a verbatim check is suspect. The
  mechanical verifier (raw bytes, literal substring) exists because of this.
- **This is one registry.** 645 capabilities weighted toward one person's
  install. The domain skew in Result 6 is a fact about this registry, not a
  universal constant.
