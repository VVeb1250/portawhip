export function steadyStateWriterInvariant(backends) {
  const writers = Object.entries(backends)
    .filter(([, backend]) => backend.steadyStateWriter === true)
    .map(([id]) => id);
  return {
    ok: writers.length === 1 && writers[0] === "rulesync",
    writers,
    expected: "rulesync",
  };
}
