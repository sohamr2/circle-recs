import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestContext } from './helpers.js';
import { clusterKey } from '../src/domain/diversity.js';

let ctx;
before(() => { ctx = createTestContext(); });
after(async () => { await ctx.app.close(); ctx.db.close(); });

const get = async (url) => {
  const res = await ctx.app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() };
};
const ids = (body) => body.recommendations.map((r) => r.circle.id);

describe('planted scenarios', () => {
  test('cold start (user 42): sensible, active, joinable, explained without personal claims', async () => {
    const { status, body } = await get('/users/42/recommendations?limit=5');
    assert.equal(status, 200);
    assert.equal(body.strategy, 'cold_start');
    assert.equal(body.recommendations.length, 5);
    for (const r of body.recommendations) {
      assert.ok(r.circle.member_count >= 4, 'no near-empty circles for a newcomer');
      assert.match(r.explanation, /^A welcoming place to start/);
      assert.doesNotMatch(r.explanation, /your interest/i);
    }
    // life-stage circles are never pushed on someone we know nothing about
    assert.ok(!ids(body).includes(19) && !ids(body).includes(29) && !ids(body).includes(33));
  });

  test('obvious matches (user 7): #5 and #6 lead', async () => {
    const { body } = await get('/users/7/recommendations');
    assert.deepEqual(ids(body).slice(0, 2), [5, 6]);
    assert.equal(body.strategy, 'personalized');
    assert.match(body.recommendations[0].explanation, /leadership skills/);
    assert.match(body.recommendations[1].explanation, /public speaking/);
  });

  test('duplicates (user 15): at most one of #10/#11/#12, the others appear as alternatives', async () => {
    const { body } = await get('/users/15/recommendations?limit=20');
    const dupes = ids(body).filter((id) => [10, 11, 12].includes(id));
    assert.equal(dupes.length, 1);
    const winner = body.recommendations.find((r) => r.circle.id === dupes[0]);
    const alternatives = winner.similar_circles.map((s) => s.id);
    assert.deepEqual([...alternatives, winner.circle.id].sort(), [10, 11, 12]);
    // Her interests are negotiation + confidence: the Circle covering both (#13) and the best
    // negotiation Circle should be her top two.
    assert.deepEqual(ids(body).slice(0, 2).sort((a, b) => a - b), [13, winner.circle.id].sort((a, b) => a - b));
  });

  test('full / inactive (user 23): #22 leads, #20 and #21 never appear and are explained in debug', async () => {
    const { body } = await get('/users/23/recommendations?limit=20&debug=true');
    assert.equal(ids(body)[0], 22);
    assert.ok(!ids(body).includes(20) && !ids(body).includes(21));
    const reasons = Object.fromEntries(body.excluded.map((e) => [e.circle_id, e.reasons]));
    assert.ok(reasons[20].includes('full'));
    assert.ok(reasons[21].includes('inactive'));
  });
});

describe('invariants across every user in the dataset', () => {
  test('every user gets a clean, explained, de-duplicated list', async () => {
    const users = ctx.db.prepare('SELECT id FROM users ORDER BY id').all();
    assert.equal(users.length, 100);

    for (const { id } of users) {
      const { status, body } = await get(`/users/${id}/recommendations?limit=10&debug=true`);
      assert.equal(status, 200, `user ${id}`);
      assert.ok(body.recommendations.length >= 5, `user ${id} got ${body.recommendations.length}`);

      const joined = new Set(ctx.db.prepare('SELECT circle_id FROM memberships WHERE user_id = ?').all(id).map((r) => r.circle_id));
      const banned = new Set(body.excluded.map((e) => e.circle_id));
      const seenClusters = new Set();
      let previousScore = Infinity;

      body.recommendations.forEach((r, i) => {
        const label = `user ${id} rank ${r.rank}`;
        assert.equal(r.rank, i + 1, label);
        assert.ok(!joined.has(r.circle.id), `${label}: already a member`);
        assert.ok(!banned.has(r.circle.id), `${label}: was excluded`);
        assert.ok(r.circle.spots_left === null || r.circle.spots_left > 0, `${label}: full`);
        assert.ok(r.score <= previousScore, `${label}: not sorted`);
        previousScore = r.score;
        assert.ok(r.explanation.length > 20 && r.explanation.length <= 220, `${label}: explanation length`);
        assert.ok((r.explanation.match(/\./g) ?? []).length <= 3, `${label}: too many sentences`);
        const key = clusterKey({ topic: r.circle.topic?.slug ?? null, tags: [], id: r.circle.id });
        assert.ok(!seenClusters.has(key), `${label}: duplicate topic cluster ${key}`);
        seenClusters.add(key);
      });

      for (const e of body.excluded) {
        if (['full', 'inactive', 'not_publicly_listed'].some((x) => e.reasons.includes(x))) {
          assert.ok(!body.recommendations.some((r) => r.circle.id === e.circle_id));
        }
      }
    }
  });

  test('responses are deterministic', async () => {
    const a = await get('/users/7/recommendations');
    const b = await get('/users/7/recommendations');
    assert.deepEqual(a.body, b.body);
  });
});

describe('HTTP contract', () => {
  test('GET /health', async () => {
    assert.deepEqual((await get('/health')).body, { status: 'ok' });
  });

  test('404 for unknown user', async () => {
    const { status, body } = await get('/users/99999/recommendations');
    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
  });

  test('400 for invalid input', async () => {
    for (const url of ['/users/abc/recommendations', '/users/0/recommendations', '/users/7/recommendations?limit=0',
      '/users/7/recommendations?limit=21', '/users/7/recommendations?limit=x', '/users/7/recommendations?bogus=1']) {
      const { status, body } = await get(url);
      assert.equal(status, 400, url);
      assert.equal(body.error, 'bad_request');
    }
  });

  test('limit is respected and debug is opt-in', async () => {
    const { body } = await get('/users/7/recommendations?limit=3');
    assert.equal(body.recommendations.length, 3);
    assert.equal(body.excluded, undefined);
    assert.equal(body.recommendations[0].debug, undefined);
    const dbg = (await get('/users/7/recommendations?limit=3&debug=true')).body;
    assert.ok(dbg.recommendations[0].debug.parts);
  });

  test('response exposes what a client needs to render a card', async () => {
    const { body } = await get('/users/7/recommendations?limit=1');
    const r = body.recommendations[0];
    for (const k of ['rank', 'circle', 'score', 'explanation', 'reasons', 'similar_circles']) assert.ok(k in r, k);
    for (const k of ['id', 'name', 'format', 'join_policy', 'member_count', 'spots_left', 'cover_image_url', 'topic']) {
      assert.ok(k in r.circle, k);
    }
  });
});

describe('seed', () => {
  test('is idempotent', async () => {
    const { seedDatabase } = await import('../src/db/seed.js');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
    const first = seedDatabase(ctx.db, dataDir);
    const second = seedDatabase(ctx.db, dataDir);
    assert.deepEqual(first, second);
    assert.equal(ctx.db.prepare('SELECT COUNT(*) n FROM circles').get().n, 40);
  });
});

describe('data integrity', () => {
  test('denormalised member_count matches the memberships table', () => {
    const rows = ctx.db.prepare(`SELECT c.id, c.member_count AS stored, COUNT(m.user_id) AS actual
      FROM circles c LEFT JOIN memberships m ON m.circle_id = c.id GROUP BY c.id`).all();
    const drift = rows.filter((r) => r.stored !== r.actual);
    assert.deepEqual(drift, []);
  });

  test('every circle has at least one leader', () => {
    const rows = ctx.db.prepare(`SELECT c.id FROM circles c WHERE NOT EXISTS
      (SELECT 1 FROM memberships m WHERE m.circle_id = c.id AND m.role = 'leader')`).all();
    assert.deepEqual(rows, []);
  });
});
