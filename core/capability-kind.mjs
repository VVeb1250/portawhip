export function capabilityKind(type) {
  if (type === "mcp" || type === "cli") return "tool";
  return type;
}

export function matchesSuggestKind(type, suggest = "any") {
  if (!suggest || suggest === "any") return true;
  return capabilityKind(type) === suggest;
}
