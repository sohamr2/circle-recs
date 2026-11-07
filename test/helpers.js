import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { createRepository } from '../src/db/repository.js';
import { buildApp } from '../src/http/app.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Fresh in-memory DB seeded from the real dataset. */
export function createTestContext() {
  const db = openDatabase(':memory:');
  seedDatabase(db, join(ROOT, 'data'));
  const repo = createRepository(db);
  const app = buildApp(repo);
  return { db, repo, app };
}

export const ASOF = new Date('2026-09-21T00:00:00.000Z');

/** Minimal Circle factory for unit tests. */
export function makeCircle(overrides = {}) {
  return {
    id: 1, slug: 'c', name: 'C', description: 'd', cover_image_url: 'x', format: 'virtual',
    access: 'public', join_policy: 'open', max_members: null, member_count: 10,
    last_activity_at: '2026-09-20T00:00:00.000Z', feed_posts_30d: 10, chat_messages_30d: 50,
    topic: 'negotiation', tags: [], ...overrides,
  };
}
