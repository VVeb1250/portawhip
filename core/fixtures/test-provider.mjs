// A capability provider that exists only for portawhip's own tests.
//
// portawhip's job is to make the provider seam work, not to make one specific
// capability work. Testing that against the real router would reintroduce the
// dependency the extraction removed — and would mean portawhip's suite only
// passes on a machine where the router happens to be installed. This fixture
// implements every part of the contract with the smallest possible behaviour,
// so the tests assert the mechanism.
//
// Registered via PORTAWHIP_EXTRA_PROVIDERS=fixture=<file url to this module>.

export const configSchema = {
  id: "fixture",
  defaults: { fixtureEnabled: true, fixtureBudget: 100 },
  definitions: {
    fixtureEnabled: { type: "boolean", description: "Whether the fixture provider contributes anything." },
    fixtureBudget: { type: "integer", min: 1, max: 1000, description: "Fixture character budget, for range-validation tests." },
    fixtureMode: { type: "enum", values: ["quiet", "loud"], description: "Fixture mode, for enum-cycling tests." },
    fixturePath: { type: "path", description: "Fixture path value, for path-resolution tests." },
    // A 0..1 fraction, so the decimal-input and range-validation paths have
    // something to exercise that an integer key cannot.
    fixtureRatio: { type: "number", min: 0, max: 1, description: "Fixture ratio, for decimal-input tests." },
  },
  mergeKeys: [],
  normalize(raw, defaults = { fixtureEnabled: true, fixtureBudget: 100 }) {
    return {
      fixtureEnabled: typeof raw.fixtureEnabled === "boolean" ? raw.fixtureEnabled : defaults.fixtureEnabled,
      fixtureBudget: typeof raw.fixtureBudget === "number" ? raw.fixtureBudget : defaults.fixtureBudget,
      fixtureRatio: typeof raw.fixtureRatio === "number" ? raw.fixtureRatio : 0.5,
      fixtureMode: ["quiet", "loud"].includes(raw.fixtureMode) ? raw.fixtureMode : "quiet",
      fixturePath: typeof raw.fixturePath === "string" && raw.fixturePath.trim() ? raw.fixturePath : "fixture.json",
    };
  },
};

export const connector = {
  id: "fixture-connector",
  summary: "Fixture connector used by portawhip's own tests",
  body: "This is the fixture connector body.",
  bodyFor(host) {
    return host === "claude-code" ? "This is the fixture connector body, claude-code variant." : this.body;
  },
};

export const hooks = {
  // Says something only for a prompt that opts in, so the same fixture covers
  // both the "provider contributes" and "provider stays silent" paths.
  async onUserPrompt({ prompt, host }) {
    if (!prompt.includes("fixture-please")) return null;
    return `fixture provider says hello to ${host}`;
  },
  async onPostTool({ id, toolName }) {
    if (!id) return null;
    return `fixture provider noticed ${toolName} matched ${id}`;
  },
};
