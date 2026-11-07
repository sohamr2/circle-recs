import { POLICY } from './config.js';
import { buildInterestProfile } from './domain/interestProfile.js';
import { computeHealth } from './domain/activity.js';
import { checkEligibility } from './domain/eligibility.js';
import { scoreCircle } from './domain/scoring.js';
import { collapseNearDuplicates } from './domain/diversity.js';
import { buildExplanation } from './domain/explain.js';

/** Topics backed by first-hand evidence (not merely related or inferred from tags of others). */
function directTopicsOf(profile) {
  return new Set([...profile.signals].filter(([, s]) => s.source !== 'related').map(([slug]) => slug));
}

export class UserNotFoundError extends Error {
  constructor(userId) {
    super(`User ${userId} not found`);
    this.name = 'UserNotFoundError';
    this.userId = userId;
  }
}

const round = (n, places = 3) => Number(n.toFixed(places));

/**
 * Pipeline:  load -> interest profile -> eligibility gate -> score -> collapse duplicates -> top N -> explain
 *
 * @param {ReturnType<import('./db/repository.js').createRepository>} repo
 * @param {number} userId
 * @param {{ limit?: number, debug?: boolean }} [options]
 */
export function recommendCircles(repo, userId, { limit = POLICY.defaults.limit, debug = false } = {}) {
  const user = repo.getUser(userId);
  if (!user) throw new UserNotFoundError(userId);

  const asOf = repo.snapshotAt();
  const windowStart = new Date(asOf.getTime() - POLICY.health.windowDays * 86_400_000);

  const circles = repo.allCircles();
  const circlesById = new Map(circles.map((c) => [c.id, c]));
  const joinedCircleIds = repo.memberCircleIds(userId);
  const joined = [...joinedCircleIds].map((id) => circlesById.get(id)).filter(Boolean);

  const profile = buildInterestProfile(user, repo.getInterests(userId), joined);
  const topicLabels = repo.topicLabels();
  const demand = repo.topicDemand();
  const postStats = repo.postStatsByCircle(windowStart, asOf);
  const coMembership = repo.coMembership(userId);

  const directTopics = directTopicsOf(profile);
  const excluded = [];
  const scored = [];
  for (const circle of circles) {
    const verdict = checkEligibility(circle, { joinedCircleIds, asOf, directTopics });
    if (!verdict.eligible) {
      excluded.push({ circle_id: circle.id, name: circle.name, reasons: verdict.reasons });
      continue;
    }
    const health = computeHealth(circle, postStats.get(circle.id), asOf);
    const peerInfo = coMembership.get(circle.id);
    const result = scoreCircle({
      circle, profile, health,
      peers: peerInfo?.peers ?? 0,
      popularity: circle.topic ? (demand.get(circle.topic) ?? 0) : 0,
    });
    scored.push({ circle, score: result.score, scored: result, health, peerInfo });
  }

  const ranked = collapseNearDuplicates(scored, POLICY.defaults.similarCirclesShown).slice(0, limit);

  const recommendations = ranked.map((item, index) => {
    const { circle } = item;
    const viaName = item.peerInfo?.viaCircleId ? circlesById.get(item.peerInfo.viaCircleId)?.name : null;
    const { explanation, reasons } = buildExplanation({
      circle, scored: item.scored, profile, topicLabels, peerInfo: item.peerInfo,
      viaCircleName: viaName, health: item.health,
    });
    const rec = {
      rank: index + 1,
      circle: {
        id: circle.id,
        name: circle.name,
        slug: circle.slug,
        description: circle.description,
        topic: circle.topic ? { slug: circle.topic, label: topicLabels.get(circle.topic) } : null,
        format: circle.format,
        join_policy: circle.join_policy,
        member_count: circle.member_count,
        max_members: circle.max_members,
        spots_left: item.scored.spotsLeft,
        cover_image_url: circle.cover_image_url,
      },
      score: round(item.score),
      explanation,
      reasons,
      similar_circles: item.similar.map((s) => ({ id: s.circle.id, name: s.circle.name })),
    };
    if (debug) {
      rec.debug = {
        parts: Object.fromEntries(Object.entries(item.scored.parts).map(([k, v]) => [k, round(v)])),
        health: Object.fromEntries(Object.entries(item.health.components).map(([k, v]) => [k, round(v)])),
        matches: item.scored.matches.map((m) => ({ topic: m.slug, kind: m.kind, source: m.signal.source })),
      };
    }
    return rec;
  });

  const response = {
    user_id: user.id,
    strategy: profile.strategy,
    as_of: asOf.toISOString(),
    recommendations,
  };
  if (debug) response.excluded = excluded;
  return response;
}
