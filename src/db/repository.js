/**
 * Read-side data access. Returns plain objects so the domain layer never sees SQL or
 * driver types. All queries are parameterised.
 */
export function createRepository(db) {
  const q = {
    snapshot: db.prepare("SELECT value FROM meta WHERE key = 'snapshot_at'"),
    user: db.prepare(`SELECT id, first_name, last_name, bio, job_title, industry, location,
      profile_completeness FROM users WHERE id = ?`),
    interests: db.prepare(`SELECT t.slug FROM user_topic_interests uti
      JOIN topics t ON t.id = uti.topic_id WHERE uti.user_id = ? ORDER BY t.slug`),
    topics: db.prepare('SELECT slug, label FROM topics'),
    demand: db.prepare(`SELECT t.slug, COUNT(*) AS n FROM user_topic_interests uti
      JOIN topics t ON t.id = uti.topic_id GROUP BY t.slug`),
    circles: db.prepare(`SELECT c.id, c.slug, c.name, c.description, c.cover_image_url, c.format,
      c.access, c.join_policy, c.max_members, c.member_count, c.last_activity_at,
      c.feed_posts_30d, c.chat_messages_30d, t.slug AS topic
      FROM circles c LEFT JOIN topics t ON t.id = c.topic_id`),
    circleTags: db.prepare(`SELECT ct.circle_id, t.slug FROM circle_topics ct
      JOIN topics t ON t.id = ct.topic_id ORDER BY ct.circle_id, t.slug`),
    memberCircleIds: db.prepare('SELECT circle_id FROM memberships WHERE user_id = ?'),
    postStats: db.prepare(`SELECT circle_id, COUNT(*) AS posts, COUNT(DISTINCT author_user_id) AS authors,
      SUM(reaction_count) AS reactions, SUM(comment_count) AS comments, SUM(save_count) AS saves
      FROM circle_posts WHERE created_at > ? AND created_at <= ? GROUP BY circle_id`),
    // "Peers" = other members of the circles I'm in. For every circle I'm NOT in, count the
    // distinct peers who belong to it and which of my circles they share with me.
    coMembership: db.prepare(`SELECT m2.circle_id AS circle_id, m1.circle_id AS via_circle_id,
      COUNT(DISTINCT m1.user_id) AS peers
      FROM memberships m1
      JOIN memberships m2 ON m2.user_id = m1.user_id
      WHERE m1.user_id <> @userId
        AND m1.circle_id IN (SELECT circle_id FROM memberships WHERE user_id = @userId)
        AND m2.circle_id NOT IN (SELECT circle_id FROM memberships WHERE user_id = @userId)
      GROUP BY m2.circle_id, m1.circle_id`),
    coMembershipTotals: db.prepare(`SELECT m2.circle_id AS circle_id, COUNT(DISTINCT m1.user_id) AS peers
      FROM memberships m1
      JOIN memberships m2 ON m2.user_id = m1.user_id
      WHERE m1.user_id <> @userId
        AND m1.circle_id IN (SELECT circle_id FROM memberships WHERE user_id = @userId)
        AND m2.circle_id NOT IN (SELECT circle_id FROM memberships WHERE user_id = @userId)
      GROUP BY m2.circle_id`),
  };

  return {
    snapshotAt() {
      const row = q.snapshot.get();
      return row ? new Date(row.value) : new Date();
    },

    getUser: (id) => q.user.get(id) ?? null,
    getInterests: (id) => q.interests.all(id).map((r) => r.slug),
    topicLabels: () => new Map(q.topics.all().map((t) => [t.slug, t.label])),

    /** Share of members interested in each topic, normalised to 0-1 by the most popular topic. */
    topicDemand() {
      const rows = q.demand.all();
      const max = Math.max(1, ...rows.map((r) => r.n));
      return new Map(rows.map((r) => [r.slug, r.n / max]));
    },

    /** Every circle with its secondary topics attached. */
    allCircles() {
      const tags = new Map();
      for (const { circle_id, slug } of q.circleTags.all()) {
        if (!tags.has(circle_id)) tags.set(circle_id, []);
        tags.get(circle_id).push(slug);
      }
      return q.circles.all().map((c) => ({ ...c, tags: tags.get(c.id) ?? [] }));
    },

    memberCircleIds: (userId) => new Set(q.memberCircleIds.all(userId).map((r) => r.circle_id)),

    /** Posts/authors/engagement per circle inside (from, to]. */
    postStatsByCircle(from, to) {
      return new Map(q.postStats.all(from.toISOString(), to.toISOString()).map((r) => [r.circle_id, r]));
    },

    /**
     * Map<circleId, { peers, viaCircleId }>: how many distinct members of my Circles also belong
     * to that Circle, and the shared Circle with the most overlap (used to name it).
     */
    coMembership(userId) {
      const out = new Map(q.coMembershipTotals.all({ userId }).map((r) => [r.circle_id, { peers: r.peers, viaCircleId: null, viaPeers: 0 }]));
      for (const r of q.coMembership.all({ userId })) {
        const entry = out.get(r.circle_id);
        if (r.peers > entry.viaPeers) Object.assign(entry, { viaCircleId: r.via_circle_id, viaPeers: r.peers });
      }
      return new Map([...out].map(([id, v]) => [id, { peers: v.peers, viaCircleId: v.viaCircleId }]));
    },
  };
}
