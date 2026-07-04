export function capabilityKind(type) {
  return type === "skill" ? "skill" : "tool";
}

export function matchesSuggestKind(type, suggest = "any") {
  if (!suggest || suggest === "any") return true;
  return capabilityKind(type) === suggest;
}

