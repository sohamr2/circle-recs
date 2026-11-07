/**
 * Near-duplicate handling.
 *
 * Circles that share a primary topic are treated as near-duplicates: they compete for the same
 * member intent, so only the best-scoring one earns a slot. The others aren't discarded; they're
 * attached to the winner as `similar` so a member can still see the alternatives.
 *
 * Why the primary topic and not text similarity? The primary topic is a curated, structured field
 * (names and descriptions are free text and vary: "Negotiation Circle" vs "Negotiate Like a Leader").
 * Circles with no primary topic fall back to their first tag, and are otherwise never grouped.
 */
export function clusterKey(circle) {
  return circle.topic ?? circle.tags[0] ?? `circle:${circle.id}`;
}

/**
 * @template {{ circle: { id: number, topic: string|null, tags: string[] }, score: number }} T
 * @param {T[]} scored candidates, any order
 * @param {number} maxSimilar how many alternatives to attach to each winner
 * @returns {Array<T & { similar: T[] }>} winners sorted by score desc
 */
export function collapseNearDuplicates(scored, maxSimilar) {
  const byScoreThenId = (a, b) => b.score - a.score || a.circle.id - b.circle.id;
  const clusters = new Map();
  for (const item of [...scored].sort(byScoreThenId)) {
    const key = clusterKey(item.circle);
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(item);
  }
  return [...clusters.values()]
    .map(([winner, ...rest]) => ({ ...winner, similar: rest.slice(0, maxSimilar) }))
    .sort(byScoreThenId);
}
