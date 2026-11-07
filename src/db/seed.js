import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readJson = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

/**
 * Validates referential integrity of the raw JSON before it touches the database, so a
 * bad dataset fails loudly with a useful message instead of producing silent bad recs.
 */
export function validateDataset({ topics, users, circles, memberships, activity }) {
  const errors = [];
  const topicSlugs = new Set(topics.map((t) => t.slug));
  const userIds = new Set(users.map((u) => u.id));
  const circleIds = new Set(circles.map((c) => c.id));

  for (const u of users) {
    for (const t of u.topic_interests ?? []) {
      if (!topicSlugs.has(t)) errors.push(`user ${u.id}: unknown topic "${t}"`);
    }
  }
  for (const c of circles) {
    if (c.topic && !topicSlugs.has(c.topic)) errors.push(`circle ${c.id}: unknown topic "${c.topic}"`);
    for (const t of c.tags ?? []) {
      if (!topicSlugs.has(t)) errors.push(`circle ${c.id}: unknown tag "${t}"`);
    }
  }
  for (const m of memberships) {
    if (!userIds.has(m.user_id)) errors.push(`membership: unknown user ${m.user_id}`);
    if (!circleIds.has(m.circle_id)) errors.push(`membership: unknown circle ${m.circle_id}`);
  }
  for (const a of activity) {
    if (!circleIds.has(a.circle_id)) errors.push(`activity ${a.id}: unknown circle ${a.circle_id}`);
    if (!userIds.has(a.author_user_id)) errors.push(`activity ${a.id}: unknown author ${a.author_user_id}`);
  }
  if (errors.length) throw new Error(`Dataset validation failed:\n  ${errors.join('\n  ')}`);
}

/**
 * Loads the JSON dataset into the database in a single transaction. Idempotent: it clears
 * existing rows first, so re-running `npm run seed` always yields the same state.
 *
 * Also records `snapshot_at` (the newest timestamp in the data). Recency is computed
 * relative to that moment rather than the wall clock; otherwise a static snapshot would
 * look stale the day after it was generated.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} dataDir
 */
export function seedDatabase(db, dataDir) {
  const dataset = {
    topics: readJson(dataDir, 'topics.json'),
    users: readJson(dataDir, 'users.json'),
    circles: readJson(dataDir, 'circles.json'),
    memberships: readJson(dataDir, 'memberships.json'),
    activity: readJson(dataDir, 'activity.json'),
  };
  validateDataset(dataset);

  const topicId = new Map(dataset.topics.map((t) => [t.slug, t.id]));

  const insert = {
    topic: db.prepare('INSERT INTO topics (id, slug, label, domain) VALUES (?, ?, ?, ?)'),
    user: db.prepare(`INSERT INTO users (id, first_name, last_name, has_photo, bio, job_title, company,
      industry, location, joined_at, profile_completeness) VALUES (?,?,?,?,?,?,?,?,?,?,?)`),
    interest: db.prepare('INSERT OR IGNORE INTO user_topic_interests (user_id, topic_id) VALUES (?, ?)'),
    circle: db.prepare(`INSERT INTO circles (id, slug, name, description, topic_id, cover_image_url, format,
      access, join_policy, max_members, member_count, created_at, last_activity_at, feed_posts_30d,
      chat_messages_30d) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`),
    circleTopic: db.prepare('INSERT OR IGNORE INTO circle_topics (circle_id, topic_id) VALUES (?, ?)'),
    membership: db.prepare('INSERT INTO memberships (user_id, circle_id, role, joined_at) VALUES (?,?,?,?)'),
    post: db.prepare(`INSERT INTO circle_posts (id, circle_id, author_user_id, body, reaction_count,
      comment_count, save_count, created_at) VALUES (?,?,?,?,?,?,?,?)`),
    meta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
  };

  const run = db.transaction(() => {
    for (const table of ['circle_posts', 'memberships', 'circle_topics', 'circles',
      'user_topic_interests', 'users', 'topics', 'meta']) {
      db.exec(`DELETE FROM ${table}`);
    }
    for (const t of dataset.topics) insert.topic.run(t.id, t.slug, t.label, t.domain);
    for (const u of dataset.users) {
      insert.user.run(u.id, u.first_name, u.last_name, u.has_photo ? 1 : 0, u.bio, u.job_title,
        u.company, u.industry, u.location, u.joined_at, u.profile_completeness);
      for (const slug of u.topic_interests ?? []) insert.interest.run(u.id, topicId.get(slug));
    }
    for (const c of dataset.circles) {
      insert.circle.run(c.id, c.slug, c.name, c.description, c.topic ? topicId.get(c.topic) : null,
        c.cover_image_url, c.format, c.access, c.join_policy, c.max_members, c.member_count,
        c.created_at, c.last_activity_at, c.feed_posts_30d, c.chat_messages_30d);
      for (const slug of c.tags ?? []) insert.circleTopic.run(c.id, topicId.get(slug));
    }
    for (const m of dataset.memberships) insert.membership.run(m.user_id, m.circle_id, m.role, m.joined_at);
    for (const a of dataset.activity) {
      insert.post.run(a.id, a.circle_id, a.author_user_id, a.body, a.reaction_count,
        a.comment_count, a.save_count, a.created_at);
    }

    const stamps = [
      ...dataset.circles.map((c) => c.last_activity_at),
      ...dataset.activity.map((a) => a.created_at),
    ];
    insert.meta.run('snapshot_at', stamps.reduce((a, b) => (a > b ? a : b)));
  });
  run();

  return {
    topics: dataset.topics.length, users: dataset.users.length, circles: dataset.circles.length,
    memberships: dataset.memberships.length, posts: dataset.activity.length,
  };
}
