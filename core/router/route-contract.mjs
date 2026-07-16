// The published `route` payload contract, written once as an executable schema.
// This server ships on npm (github.com/VVeb1250/portawhip) and external callers
// parse this JSON, so the shape is an API: additive changes only, never a rename
// or removal (see the same rule spelled out in route-entry.mjs's explainRoute).
//
// Enforced in tests, not at runtime, and that is deliberate. The payload is built
// deterministically by our own code — a runtime parse would only ever catch OUR
// bug, and neither answer is acceptable in a published server's hot path:
// throwing turns a cosmetic drift into a crashed session, and degrading silently
// is the failure class this codebase already refuses elsewhere. Tests fail loudly
// at the only time anyone can act on it. Keep it that way.
//
// `strictObject` is the load-bearing part: it rejects unknown keys, so internal
// scoring fields (score/confidence/why/origin) and any future context-carrying
// field cannot silently leak into a published payload.

import { z } from "zod";

// A capability the model has not seen this session: the full recognition payload.
const FreshHitSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  // capabilityKind() maps mcp|cli -> "tool" and passes every other type through,
  // so this is an open set (skill, command, agent, config-sync, ...), not an enum.
  kind: z.string().min(1),
  state: z.literal("fresh"),
  // explainRoute only ever promotes these two tiers into `results`; a weak_match
  // reaching the payload is a bug this schema should catch.
  tier: z.enum(["required", "recommended"]),
  action: z.string().min(1),
  how_to_use: z.string().min(1),
  pointer: z.string().min(1),
  skip_when: z.string().min(1).optional(),
  readyMarker: z.string().min(1).optional(),
  readyHint: z.string().min(1).optional(),
});

// Already in context: a nudge, not a re-pitch. The exact three keys ARE the
// R5/E4 token-budget promise (docs/recognition-router.md) — structurally, not by
// convention. Anything richer here is a regression.
const ReuseHitSchema = z.strictObject({
  id: z.string().min(1),
  state: z.literal("reuse"),
  note: z.string().min(1),
});

export const RouteHitSchema = z.discriminatedUnion("state", [FreshHitSchema, ReuseHitSchema]);

const EmptyResultSchema = z.strictObject({
  status: z.literal("empty"),
  reason: z.string().min(1),
});

const SuccessResultSchema = z
  .strictObject({
    status: z.literal("success"),
    mode: z.literal("candidates").optional(),
    note: z.string().min(1).optional(),
    results: z.array(RouteHitSchema).min(1),
  })
  .refine((value) => (value.mode === undefined) === (value.note === undefined), {
    message: "mode and note must be emitted together (a candidate set is always declarative)",
  });

export const RouteResultSchema = z.discriminatedUnion("status", [
  EmptyResultSchema,
  SuccessResultSchema,
]);

// Throws with a readable path/message on the first violation. Test-side helper:
// see the module header for why this is not wired into the server hot path.
export function assertRouteContract(payload) {
  const parsed = RouteResultSchema.safeParse(payload);
  if (parsed.success) return parsed.data;
  const detail = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
  throw new Error(`route payload violates the published contract — ${detail}`);
}
