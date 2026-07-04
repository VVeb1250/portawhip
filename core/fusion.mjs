export function reciprocalRankFusion(rankings, { k = 60 } = {}) {
  const scores = new Map();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i += 1) {
      const item = ranking[i];
      const current = scores.get(item.id) ?? { ...item, rrfScore: 0 };
      current.rrfScore += 1 / (k + i + 1);
      scores.set(item.id, current);
    }
  }
  return [...scores.values()].sort(
    (a, b) =>
      b.rrfScore - a.rrfScore ||
      (b.score ?? 0) - (a.score ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

