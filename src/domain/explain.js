import { POLICY } from '../config.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const lower = (s) => s.toLowerCase();
const list = (items) => (items.length <= 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Builds the member-facing "why this Circle" copy.
 *
 * Principles:
 *  - Honest: only claim what we actually used. Inferred or profile-based signals are worded as
 *    such ("Similar to...", "Based on your profile...") and never as "you told us".
 *  - Specific: lead with the member's own topic, follow with one concrete reason it's worth
 *    joining now (real post counts, real seats left), not generic praise.
 *  - Short: two sentences max. No scores, no jargon, no mention of "algorithm".
 *  - Respectful: never reference other members' identities; only anonymous counts.
 *
 * Returns the sentence(s) plus structured `reasons` so a client can render chips instead.
 */
export function buildExplanation({ circle, scored, profile, topicLabels, peerInfo, viaCircleName, health }) {
  const label = (slug) => lower(topicLabels.get(slug) ?? slug);
  const reasons = [];
  let lead;

  const strongMatches = scored.matches.filter((m) => m.signal.source === 'stated');
  const best = scored.matches[0];

  if (profile.strategy === 'cold_start' || !best) {
    const topic = circle.topic ?? circle.tags[0];
    lead = topic
      ? `A welcoming place to start: members here talk about ${label(topic)}.`
      : 'A welcoming place to start.';
    reasons.push({ type: 'popular_starting_point', topic: topic ?? null });
  } else if (strongMatches.length > 0) {
    const topics = [...new Set(strongMatches.map((m) => m.slug))].slice(0, 2);
    lead = strongMatches[0].kind === 'primary' || topics.length > 1
      ? `Matches your ${topics.length > 1 ? 'interests' : 'interest'} in ${list(topics.map(label))}.`
      : `Also covers ${label(topics[0])}, one of your interests.`;
    reasons.push({ type: 'interest_match', topics, source: 'stated' });
  } else if (best.signal.source === 'inferred') {
    lead = `Similar to ${best.signal.via}, which you've joined.`;
    reasons.push({ type: 'similar_to_joined', circle: best.signal.via, topic: best.slug });
  } else if (best.signal.source === 'related') {
    lead = `Explores ${label(best.slug)}, which pairs well with your interest in ${label(best.signal.via)}.`;
    reasons.push({ type: 'related_interest', topic: best.slug, relatedTo: best.signal.via });
  } else {
    lead = `Based on your profile, ${label(best.slug)} may be a good fit.`;
    reasons.push({ type: 'profile_hint', topic: best.slug });
  }

  // Second sentence: one concrete "why now" and one practical join note.
  const posts = circle.feed_posts_30d;
  const activity = posts >= 8
    ? `Very active, with ${plural(posts, 'post', 'posts')} in the last 30 days`
    : posts >= 3
      ? `${plural(posts, 'post', 'posts')} in the last 30 days`
      : 'Members have been posting recently';
  reasons.push({ type: 'active', posts_30d: posts, chat_messages_30d: circle.chat_messages_30d,
    days_since_activity: Math.floor(health.daysSinceActivity) });

  let note;
  if (scored.spotsLeft != null && scored.spotsLeft <= POLICY.availability.spotsLeftMention) {
    note = `only ${plural(scored.spotsLeft, 'spot', 'spots')} left`;
    reasons.push({ type: 'limited_spots', spots_left: scored.spotsLeft });
  } else if (peerInfo && peerInfo.peers >= POLICY.social.minPeersToMention && viaCircleName
    && !reasons.some((r) => r.type === 'similar_to_joined' && r.circle === viaCircleName)) {
    note = `${plural(peerInfo.peers, 'member', 'members')} from ${viaCircleName} ${peerInfo.peers === 1 ? 'is' : 'are'} here too`;
    reasons.push({ type: 'shared_members', count: peerInfo.peers, via_circle: viaCircleName });
  } else {
    note = circle.join_policy === 'open' ? 'open to join right away' : 'join requests are reviewed by its leaders';
  }

  return { explanation: `${lead} ${activity}, and ${note}.`, reasons };
}
