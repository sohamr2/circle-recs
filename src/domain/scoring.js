import { POLICY } from '../config.js';
import { spotsLeft } from './eligibility.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Topic relevance of a Circle to a member's interest profile.
 * Primary topic counts fully, secondary tags count 0.6; the best match leads and a second
 * distinct match adds a small bonus (a Circle covering two of my interests beats one).
 * Score = (best + bonus x second) / (1 + bonus), so only a double perfect match reaches 1.0.
 *
 * @returns {{ score: number, matches: Array<{ slug: string, kind: 'primary'|'tag', signal: import('./interestProfile.js').InterestSignal, value: number }> }}
 */
export function topicRelevance(circle, profile) {
  const w = POLICY.interest;
  const matches = [];
  const consider = (slug, kind, circleWeight) => {
    const signal = profile.signals.get(slug);
    if (signal) matches.push({ slug, kind, signal, value: circleWeight * signal.weight });
  };
  if (circle.topic) consider(circle.topic, 'primary', w.circlePrimaryWeight);
  for (const tag of circle.tags) if (tag !== circle.topic) consider(tag, 'tag', w.circleTagWeight);

  matches.sort((a, b) => b.value - a.value);
  const [best, second] = matches;
  // Normalised (not clamped) so a second matching topic still helps when the first is perfect.
  const score = best ? clamp01((best.value + w.secondMatchBonus * (second?.value ?? 0)) / (1 + w.secondMatchBonus)) : 0;
  return { score, matches };
}

/** 1.0 until the Circle is 80% full, then slides to 0.3 at the last seat (full ones are gated out). */
export function availabilityScore(circle) {
  const a = POLICY.availability;
  if (circle.max_members == null) return 1;
  const fill = circle.member_count / circle.max_members;
  if (fill <= a.nearFullStart) return 1;
  const t = clamp01((fill - a.nearFullStart) / (1 - a.nearFullStart));
  return 1 - t * (1 - a.nearFullFloor);
}

/** Very small Circles feel empty; reach critical mass at ~8 members. */
export function sizeScore(circle) {
  const { criticalMass, floor } = POLICY.size;
  return floor + (1 - floor) * clamp01(circle.member_count / criticalMass);
}

/** Basic curation signal: has a description and a cover image. */
export function qualityScore(circle) {
  return (circle.description ? 0.6 : 0) + (circle.cover_image_url ? 0.4 : 0);
}

export const joinabilityScore = (circle) => POLICY.joinPolicyScore[circle.join_policy] ?? 0.5;

export const socialScore = (peers) => clamp01(peers / POLICY.social.saturationPeers);

/**
 * Final blend. Returns the score plus the parts, so `?debug=true` can show exactly why one
 * Circle outranked another.
 */
export function scoreCircle({ circle, profile, health, peers, popularity }) {
  const relevance = topicRelevance(circle, profile);
  const parts = {
    relevance: relevance.score,
    health: health.score,
    availability: availabilityScore(circle),
    size: sizeScore(circle),
    joinability: joinabilityScore(circle),
    social: socialScore(peers),
    quality: qualityScore(circle),
    popularity,
  };
  const weights = profile.strategy === 'cold_start' ? POLICY.weights.cold_start : POLICY.weights.personalized;
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) score += weight * parts[name];
  return { score, parts, matches: relevance.matches, spotsLeft: spotsLeft(circle) };
}
