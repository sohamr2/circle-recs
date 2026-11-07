import { join } from 'node:path';

/** Runtime/environment configuration. */
export function loadConfig(root) {
  return {
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? '0.0.0.0',
    dbPath: process.env.DB_PATH ?? join(root, 'var', 'circles.db'),
    dataDir: process.env.DATA_DIR ?? join(root, 'data'),
  };
}

/**
 * Ranking policy. Everything that is a product decision lives here, not scattered through
 * the code, so it can be tuned (or later driven by experiments) without touching logic.
 */
export const POLICY = Object.freeze({
  // ---- Hard eligibility rules (a Circle failing any of these is never shown) ----------
  eligibility: {
    maxDaysSinceActivity: 30, // no activity for a month => dormant
    minPosts30d: 1,           // zero feed posts in 30 days => dormant
  },

  // ---- Activity ("health") model -------------------------------------------------------
  health: {
    windowDays: 30,
    recencyHalfLifeDays: 7,
    postsSaturation: 15,       // ~15 posts/month is "fully lively"; more adds nothing
    chatSaturation: 200,
    engagementSaturation: 20,  // weighted interactions per post that counts as "fully engaged"
    engagementWeights: { reaction: 1, comment: 2, save: 1.5 },
    breadthMaxAuthors: 5,      // 5 distinct posters is enough to call participation "broad"
    weights: { recency: 0.30, volume: 0.25, chat: 0.15, engagement: 0.15, breadth: 0.15 },
  },

  // ---- Capacity / size -----------------------------------------------------------------
  availability: {
    nearFullStart: 0.8,   // below 80% full: no penalty
    nearFullFloor: 0.3,   // score when 1 seat is left
    spotsLeftMention: 3,  // call out "N spots left" in the explanation at or below this
  },
  size: { criticalMass: 8, floor: 0.4 }, // very small Circles feel empty to a newcomer
  joinPolicyScore: { open: 1.0, request: 0.85 },

  // ---- Interest model ------------------------------------------------------------------
  interest: {
    stated: 1.0,
    inferredPrimary: 0.5,  // topic of a Circle the member already belongs to
    inferredTag: 0.25,
    related: 0.35,         // multiplier applied to a related topic's weight
    bio: 0.3,              // last resort, only when nothing else is known
    circlePrimaryWeight: 1.0,
    circleTagWeight: 0.6,
    secondMatchBonus: 0.2, // a second matching topic helps, with diminishing returns
  },

  social: { saturationPeers: 3, minPeersToMention: 2 },

  // ---- Blend. Each row sums to 1.0 -----------------------------------------------------
  weights: {
    personalized: {
      relevance: 0.50, health: 0.25, availability: 0.06, size: 0.05,
      joinability: 0.05, social: 0.06, quality: 0.03,
    },
    cold_start: {
      health: 0.45, popularity: 0.15, size: 0.12, availability: 0.10,
      joinability: 0.12, quality: 0.06,
    },
  },

  defaults: { limit: 5, maxLimit: 20, similarCirclesShown: 3 },
});
