import { POLICY } from '../config.js';
import { RELATED_TOPICS, topicsFromBio } from './topics.js';

/**
 * @typedef {'stated'|'inferred'|'related'|'bio'} InterestSource
 * @typedef {{ weight: number, source: InterestSource, via?: string }} InterestSignal
 * @typedef {{ strategy: 'personalized'|'inferred'|'cold_start', signals: Map<string, InterestSignal> }} InterestProfile
 */

function strengthen(signals, slug, signal) {
  const current = signals.get(slug);
  if (!current || signal.weight > current.weight) signals.set(slug, signal);
}

/**
 * Turns everything we know about a member into a weighted topic vector.
 *
 *   stated interests          1.00  the member told us directly
 *   topics of joined Circles  0.50  revealed preference (their tags count 0.25)
 *   related topics            0.35 x parent weight   (helps beyond exact matches)
 *   bio keywords              0.30  only if nothing else is known
 *
 * The strongest signal per topic wins; its source is kept so we can explain it honestly.
 *
 * @param {{ bio?: string|null }} user
 * @param {string[]} statedInterests topic slugs
 * @param {Array<{ name: string, topic: string|null, tags: string[] }>} joinedCircles
 * @returns {InterestProfile}
 */
export function buildInterestProfile(user, statedInterests, joinedCircles) {
  const w = POLICY.interest;
  const signals = new Map();

  for (const slug of statedInterests) strengthen(signals, slug, { weight: w.stated, source: 'stated' });

  for (const circle of joinedCircles) {
    if (circle.topic) {
      strengthen(signals, circle.topic, { weight: w.inferredPrimary, source: 'inferred', via: circle.name });
    }
    for (const tag of circle.tags) {
      strengthen(signals, tag, { weight: w.inferredTag, source: 'inferred', via: circle.name });
    }
  }

  const hasDirectSignal = signals.size > 0;
  if (!hasDirectSignal) {
    for (const slug of topicsFromBio(user.bio)) strengthen(signals, slug, { weight: w.bio, source: 'bio' });
  }

  // Spread to related topics from direct signals only (never chain related -> related).
  const direct = [...signals.entries()];
  for (const [slug, signal] of direct) {
    for (const rel of RELATED_TOPICS.get(slug) ?? []) {
      strengthen(signals, rel, { weight: signal.weight * w.related, source: 'related', via: slug });
    }
  }

  const strategy = statedInterests.length > 0 ? 'personalized' : signals.size > 0 ? 'inferred' : 'cold_start';
  return { strategy, signals };
}
