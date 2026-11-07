import { POLICY } from '../config.js';

const MS_PER_DAY = 86_400_000;
const clamp01 = (x) => Math.max(0, Math.min(1, x));
/** Log-saturating curve: diminishing returns, 1.0 once `cap` is reached. */
const saturate = (value, cap) => clamp01(Math.log1p(Math.max(0, value)) / Math.log1p(cap));

export function daysBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

/**
 * How alive is this Circle right now? Blends five signals into 0-1 and returns the parts so
 * the result is debuggable.
 *
 *  recency     exponential decay since last activity (half-life in POLICY)
 *  volume      feed posts in the last 30 days (aggregate counter, log-saturated)
 *  chat        group-chat messages in the last 30 days (log-saturated)
 *  engagement  reactions/comments/saves per post (are posts landing with people?)
 *  breadth     distinct posters vs members (a Circle run by one person isn't a community)
 *
 * Engagement and breadth need post rows. If the rows are missing but the aggregate says there
 * was activity, we use a neutral 0.5 instead of punishing the Circle for missing detail.
 *
 * @param {{ last_activity_at: string, feed_posts_30d: number, chat_messages_30d: number, member_count: number }} circle
 * @param {{ posts: number, authors: number, reactions: number, comments: number, saves: number }|undefined} stats
 * @param {Date} asOf
 */
export function computeHealth(circle, stats, asOf) {
  const p = POLICY.health;
  const daysSinceActivity = Math.max(0, daysBetween(asOf, new Date(circle.last_activity_at)));

  const recency = 0.5 ** (daysSinceActivity / p.recencyHalfLifeDays);
  const volume = saturate(circle.feed_posts_30d, p.postsSaturation);
  const chat = saturate(circle.chat_messages_30d, p.chatSaturation);

  let engagement = 0.5;
  let breadth = 0.5;
  if (stats && stats.posts > 0) {
    const e = p.engagementWeights;
    const perPost = (stats.reactions * e.reaction + stats.comments * e.comment + stats.saves * e.save) / stats.posts;
    engagement = clamp01(perPost / p.engagementSaturation);
    breadth = clamp01(stats.authors / Math.max(1, Math.min(p.breadthMaxAuthors, circle.member_count)));
  } else if (circle.feed_posts_30d === 0) {
    engagement = 0;
    breadth = 0;
  }

  const w = p.weights;
  const score = clamp01(
    w.recency * recency + w.volume * volume + w.chat * chat + w.engagement * engagement + w.breadth * breadth,
  );
  return { score, daysSinceActivity, components: { recency, volume, chat, engagement, breadth } };
}
