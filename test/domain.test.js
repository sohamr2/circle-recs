import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ASOF, makeCircle } from './helpers.js';
import { computeHealth } from '../src/domain/activity.js';
import { checkEligibility, spotsLeft, isFull } from '../src/domain/eligibility.js';
import { buildInterestProfile } from '../src/domain/interestProfile.js';
import { availabilityScore, sizeScore, topicRelevance } from '../src/domain/scoring.js';
import { collapseNearDuplicates } from '../src/domain/diversity.js';
import { topicsFromBio } from '../src/domain/topics.js';
import { buildExplanation } from '../src/domain/explain.js';

const ctx = (extra = {}) => ({ joinedCircleIds: new Set(), asOf: ASOF, directTopics: new Set(), ...extra });

describe('eligibility', () => {
  test('healthy public circle is eligible', () => {
    assert.deepEqual(checkEligibility(makeCircle(), ctx()), { eligible: true, reasons: [] });
  });

  test('full circle is excluded; uncapped is never full', () => {
    const full = makeCircle({ max_members: 15, member_count: 15 });
    assert.equal(isFull(full), true);
    assert.deepEqual(checkEligibility(full, ctx()).reasons, ['full']);
    assert.equal(isFull(makeCircle({ max_members: null, member_count: 500 })), false);
    assert.equal(spotsLeft(makeCircle({ max_members: null })), null);
    assert.equal(spotsLeft(makeCircle({ max_members: 12, member_count: 9 })), 3);
  });

  test('dormant circles are excluded (no posts, or idle > 30 days)', () => {
    assert.deepEqual(checkEligibility(makeCircle({ feed_posts_30d: 0 }), ctx()).reasons, ['inactive']);
    const stale = makeCircle({ last_activity_at: '2026-07-01T00:00:00.000Z' });
    assert.deepEqual(checkEligibility(stale, ctx()).reasons, ['inactive']);
  });

  test('reports every failing reason', () => {
    const c = makeCircle({ access: 'unlisted', feed_posts_30d: 0, max_members: 5, member_count: 5 });
    assert.deepEqual(checkEligibility(c, ctx()).reasons.sort(), ['full', 'inactive', 'not_publicly_listed']);
  });

  test('already-joined and topic-less circles are excluded', () => {
    assert.deepEqual(checkEligibility(makeCircle({ id: 9 }), ctx({ joinedCircleIds: new Set([9]) })).reasons, ['already_member']);
    assert.deepEqual(checkEligibility(makeCircle({ topic: null, tags: [] }), ctx()).reasons, ['no_topic_information']);
  });

  test('sensitive topics need a direct signal', () => {
    const c = makeCircle({ topic: 'working-motherhood' });
    assert.deepEqual(checkEligibility(c, ctx()).reasons, ['sensitive_topic_without_interest']);
    assert.equal(checkEligibility(c, ctx({ directTopics: new Set(['working-motherhood']) })).eligible, true);
  });
});

describe('activity health', () => {
  const stats = { posts: 10, authors: 5, reactions: 100, comments: 40, saves: 20 };

  test('a lively recent circle scores high; a dormant one scores near zero', () => {
    const lively = computeHealth(makeCircle({ feed_posts_30d: 15, chat_messages_30d: 200 }), stats, ASOF);
    const dormant = computeHealth(
      makeCircle({ feed_posts_30d: 0, chat_messages_30d: 2, last_activity_at: '2026-02-01T00:00:00.000Z' }),
      undefined, ASOF);
    assert.ok(lively.score > 0.8, `lively=${lively.score}`);
    assert.ok(dormant.score < 0.1, `dormant=${dormant.score}`);
  });

  test('recency decays with a 7-day half-life', () => {
    const fresh = computeHealth(makeCircle({ last_activity_at: ASOF.toISOString() }), stats, ASOF);
    const weekOld = computeHealth(makeCircle({ last_activity_at: '2026-09-14T00:00:00.000Z' }), stats, ASOF);
    assert.ok(Math.abs(fresh.components.recency - 1) < 1e-9);
    assert.ok(Math.abs(weekOld.components.recency - 0.5) < 1e-9);
  });

  test('a one-person Circle scores lower on breadth than a participatory one', () => {
    const c = makeCircle({ member_count: 10 });
    const solo = computeHealth(c, { ...stats, authors: 1 }, ASOF);
    const broad = computeHealth(c, { ...stats, authors: 5 }, ASOF);
    assert.ok(broad.score > solo.score);
  });

  test('missing post rows fall back to neutral instead of punishing the circle', () => {
    const h = computeHealth(makeCircle({ feed_posts_30d: 6 }), undefined, ASOF);
    assert.equal(h.components.engagement, 0.5);
    assert.equal(h.components.breadth, 0.5);
  });

  test('score is always within [0, 1]', () => {
    const huge = computeHealth(makeCircle({ feed_posts_30d: 9999, chat_messages_30d: 99999 }),
      { posts: 1, authors: 99, reactions: 9999, comments: 9999, saves: 9999 }, ASOF);
    assert.ok(huge.score <= 1 && huge.score >= 0);
  });
});

describe('interest profile', () => {
  const noCircles = [];

  test('stated interests dominate and strategy is personalized', () => {
    const p = buildInterestProfile({ bio: null }, ['negotiation'], noCircles);
    assert.equal(p.strategy, 'personalized');
    assert.equal(p.signals.get('negotiation').weight, 1);
    assert.equal(p.signals.get('getting-promoted').source, 'related');
  });

  test('joined circles reveal interest when none are stated', () => {
    const p = buildInterestProfile({ bio: null }, [], [{ name: 'Mentors', topic: 'sponsorship-mentorship', tags: ['networking'] }]);
    assert.equal(p.strategy, 'inferred');
    assert.equal(p.signals.get('sponsorship-mentorship').source, 'inferred');
    assert.equal(p.signals.get('sponsorship-mentorship').via, 'Mentors');
  });

  test('bio is a last resort: used only when nothing else is known', () => {
    const bio = 'Returning to work after a career break and finding my footing.';
    assert.equal(buildInterestProfile({ bio }, [], noCircles).signals.get('career-breaks').source, 'bio');
    const withStated = buildInterestProfile({ bio }, ['negotiation'], noCircles);
    assert.equal(withStated.signals.has('career-breaks'), false);
  });

  test('empty member is cold start', () => {
    const p = buildInterestProfile({ bio: null }, [], noCircles);
    assert.equal(p.strategy, 'cold_start');
    assert.equal(p.signals.size, 0);
  });

  test('related topics never chain (no related -> related)', () => {
    const p = buildInterestProfile({ bio: null }, ['negotiation'], noCircles);
    // negotiation -> confidence (related) -> imposter-syndrome would be a chain; must not appear.
    assert.equal(p.signals.has('imposter-syndrome'), false);
  });

  test('bio keyword mapping', () => {
    assert.deepEqual(topicsFromBio('Advocate for pay equity and transparent promotion paths.').sort(), ['getting-promoted', 'negotiation']);
    assert.deepEqual(topicsFromBio(null), []);
  });
});

describe('scoring primitives', () => {
  test('primary match outranks tag match; two matches beat one', () => {
    const profile = buildInterestProfile({}, ['negotiation', 'confidence'], []);
    const primary = topicRelevance(makeCircle({ topic: 'negotiation' }), profile).score;
    const tagOnly = topicRelevance(makeCircle({ topic: 'allyship', tags: ['negotiation'] }), profile).score;
    const both = topicRelevance(makeCircle({ topic: 'negotiation', tags: ['confidence'] }), profile).score;
    assert.ok(primary > tagOnly);
    assert.ok(both > primary);
  });

  test('availability is flat until 80% full, then falls', () => {
    assert.equal(availabilityScore(makeCircle({ max_members: null })), 1);
    assert.equal(availabilityScore(makeCircle({ max_members: 20, member_count: 16 })), 1);
    assert.ok(availabilityScore(makeCircle({ max_members: 20, member_count: 19 })) < 0.5);
  });

  test('tiny circles are mildly penalised', () => {
    assert.ok(sizeScore(makeCircle({ member_count: 3 })) < sizeScore(makeCircle({ member_count: 12 })));
    assert.equal(sizeScore(makeCircle({ member_count: 50 })), 1);
  });
});

describe('near-duplicate collapse', () => {
  const item = (id, topic, score) => ({ circle: makeCircle({ id, topic, tags: [] }), score });

  test('keeps only the best circle per primary topic and attaches the rest', () => {
    const out = collapseNearDuplicates([item(10, 'negotiation', 0.7), item(11, 'negotiation', 0.9),
      item(12, 'negotiation', 0.8), item(5, 'leadership-skills', 0.6)], 3);
    assert.deepEqual(out.map((o) => o.circle.id), [11, 5]);
    assert.deepEqual(out[0].similar.map((s) => s.circle.id), [12, 10]);
    assert.deepEqual(out[1].similar, []);
  });

  test('ties break deterministically by id', () => {
    const out = collapseNearDuplicates([item(2, 'a', 0.5), item(1, 'a', 0.5)], 3);
    assert.equal(out[0].circle.id, 1);
  });

  test('topic-less circles are not grouped together', () => {
    const mk = (id) => ({ circle: makeCircle({ id, topic: null, tags: [] }), score: 0.5 });
    assert.equal(collapseNearDuplicates([mk(1), mk(2)], 3).length, 2);
  });
});

describe('explanations', () => {
  const labels = new Map([['negotiation', 'Negotiation'], ['leadership-skills', 'Leadership skills']]);
  const health = { daysSinceActivity: 1 };
  const base = { circle: makeCircle(), topicLabels: labels, health, peerInfo: undefined, viaCircleName: null };

  const explain = (matches, strategy = 'personalized', extra = {}) => buildExplanation({
    ...base, ...extra, profile: { strategy }, scored: { matches, spotsLeft: null },
  });

  test('stated primary match names the member\'s own interest', () => {
    const { explanation } = explain([{ slug: 'negotiation', kind: 'primary', signal: { source: 'stated', weight: 1 }, value: 1 }]);
    assert.match(explanation, /^Matches your interest in negotiation\./);
    assert.match(explanation, /10 posts in the last 30 days|Very active, with 10 posts/);
  });

  test('inferred signals are never worded as "you told us"', () => {
    const { explanation } = explain([{ slug: 'negotiation', kind: 'primary', signal: { source: 'inferred', via: 'Board-Ready Women', weight: 0.5 }, value: 0.5 }]);
    assert.match(explanation, /^Similar to Board-Ready Women, which you've joined\./);
    assert.doesNotMatch(explanation, /your interest/);
  });

  test('cold start does not claim any personal match', () => {
    const { explanation } = explain([], 'cold_start');
    assert.match(explanation, /^A welcoming place to start/);
    assert.doesNotMatch(explanation, /your/);
  });

  test('mentions scarce seats and join policy truthfully', () => {
    const near = buildExplanation({ ...base, profile: { strategy: 'personalized' },
      scored: { matches: [{ slug: 'negotiation', kind: 'primary', signal: { source: 'stated', weight: 1 }, value: 1 }], spotsLeft: 2 } });
    assert.match(near.explanation, /only 2 spots left/);
    const request = explain([{ slug: 'negotiation', kind: 'primary', signal: { source: 'stated', weight: 1 }, value: 1 }], 'personalized',
      { circle: makeCircle({ join_policy: 'request' }) });
    assert.match(request.explanation, /reviewed by its leaders/);
  });

  test('does not repeat the joined circle name in the peers note', () => {
    const { explanation } = explain(
      [{ slug: 'negotiation', kind: 'primary', signal: { source: 'inferred', via: 'Board-Ready Women', weight: 0.5 }, value: 0.5 }],
      'personalized', { peerInfo: { peers: 3 }, viaCircleName: 'Board-Ready Women' });
    assert.equal(explanation.match(/Board-Ready Women/g).length, 1);
  });

  test('low-volume circles are not oversold', () => {
    const { explanation } = explain([{ slug: 'negotiation', kind: 'primary', signal: { source: 'stated', weight: 1 }, value: 1 }],
      'personalized', { circle: makeCircle({ feed_posts_30d: 2 }) });
    assert.doesNotMatch(explanation, /Very active/);
  });
});
