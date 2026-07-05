import { test } from "node:test";
import assert from "node:assert/strict";
import { actionAlignmentFactor } from "./concept-vector.mjs";

test("actionAlignmentFactor: neutral when query has no clear action-intent", () => {
  const doc = { id: "react-testing", triggers: [], description: "" };
  assert.equal(actionAlignmentFactor(doc, "PostgreSQL schema design and query optimization"), 1.0);
});

test("actionAlignmentFactor: neutral when doc id has no action-cluster word", () => {
  const doc = { id: "react-patterns", triggers: [], description: "hooks and boundaries" };
  assert.equal(actionAlignmentFactor(doc, "add a new component"), 1.0);
});

test("actionAlignmentFactor: demotes a doc whose action-intent conflicts with the query's", () => {
  const doc = { id: "react-testing", triggers: [], description: "" };
  assert.equal(actionAlignmentFactor(doc, "add a new component"), 0.6);
});

test("actionAlignmentFactor: boosts a doc whose action-intent matches the query's", () => {
  const doc = { id: "cpp-testing", triggers: [], description: "" };
  assert.equal(actionAlignmentFactor(doc, "fix a failing test"), 1.15);
});

test("actionAlignmentFactor: id is trusted over a noisy description", () => {
  // security-review's own description talks about "adding authentication,
  // implementing payment features" (build-flavored activation prose), which
  // must not outvote the "review" signal already carried by the id alone.
  const doc = {
    id: "security-review",
    triggers: [],
    description:
      "Use this skill when adding authentication, handling user input, creating API endpoints, or implementing payment features.",
  };
  assert.equal(actionAlignmentFactor(doc, "run a security review for authentication code"), 1.15);
});
