import { POLICY } from '../config.js';
import { daysBetween } from './activity.js';

/** @returns {number|null} seats remaining, or null when the Circle is uncapped */
export function spotsLeft(circle) {
  return circle.max_members == null ? null : Math.max(0, circle.max_members - circle.member_count);
}

/** Topics tied to life stage or lived experience: recommend only on a direct signal. */
export const SENSITIVE_TOPICS = new Set(['working-motherhood', 'career-breaks', 'being-the-only-one']);

export const isFull = (circle) => circle.max_members != null && circle.member_count >= circle.max_members;

/**
 * Hard gate. A Circle that fails is excluded outright rather than down-weighted: showing a
 * member a Circle they can't join, or one nobody is posting in, burns trust faster than any
 * ranking nuance can earn it back.
 *
 * Returns every failing reason (not just the first) so `?debug=true` tells the full story,
 * e.g. a Circle that is both unlisted and dormant.
 *
 * @param {object} circle
 * @param {{ joinedCircleIds: Set<number>, asOf: Date, directTopics: Set<string> }} ctx
 *   directTopics = topics the member has a first-hand signal for (stated, joined, or bio)
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function checkEligibility(circle, { joinedCircleIds, asOf, directTopics }) {
  const rules = POLICY.eligibility;
  const reasons = [];

  if (joinedCircleIds.has(circle.id)) reasons.push('already_member');
  if (circle.access !== 'public') reasons.push('not_publicly_listed');
  if (isFull(circle)) reasons.push('full');

  const daysIdle = daysBetween(asOf, new Date(circle.last_activity_at));
  if (circle.feed_posts_30d < rules.minPosts30d || daysIdle > rules.maxDaysSinceActivity) {
    reasons.push('inactive');
  }
  // We can't explain (or topic-match) a Circle with no topic information at all.
  if (!circle.topic && circle.tags.length === 0) reasons.push('no_topic_information');

  // Life-stage / identity-adjacent Circles are never inferred for someone. They are shown only
  // when the member has told us (or shown us) they care, never as a cold-start or backfill pick.
  if (circle.topic && SENSITIVE_TOPICS.has(circle.topic) && !directTopics.has(circle.topic)) {
    reasons.push('sensitive_topic_without_interest');
  }
  return { eligible: reasons.length === 0, reasons };
}
