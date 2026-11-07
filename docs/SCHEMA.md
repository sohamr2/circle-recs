# Database Schema

SQLite, defined in [`src/db/schema.sql`](../src/db/schema.sql). It is written to port to Postgres with
few changes (`TEXT` timestamps become `timestamptz`; the `CHECK` constraints carry over as they are).

```
topics ──────────┬──────────────< user_topic_interests >────── users
 (taxonomy)      │                                              │
                 ├──────────────< circle_topics >──┐            │
                 │                                 │            │
                 └─ topic_id (primary, nullable) ─ circles ─────┤
                                                   │  │         │
                                      memberships >┘  └< circle_posts (author_user_id → users)
                                      (user_id, circle_id, role)
meta (key/value: snapshot_at)
```

| Table | Purpose | Key decisions |
| --- | --- | --- |
| `topics` | Taxonomy | `slug` unique; everything else references `id`. |
| `users` | Profile fields | Interests live in their own table, not a JSON column. |
| `user_topic_interests` | Stated interests (M:N) | PK `(user_id, topic_id)`; index on `topic_id` answers "who cares about X" and feeds topic demand. |
| `circles` | Circle profile, capacity, activity aggregates | `max_members` NULL means uncapped; `topic_id` nullable because some Circles have none; `CHECK`s on enums and counters. |
| `circle_topics` | Secondary topics ("tags") | Tags resolve into the same taxonomy, so matching is one code path. The composite PK also de-duplicates repeated tags (Circle 17 had one). |
| `memberships` | Who belongs where, and role | PK `(user_id, circle_id)` serves "my Circles"; the reverse index `(circle_id, user_id)` serves co-membership. |
| `circle_posts` | Feed posts with engagement | Index `(circle_id, created_at)` for the 30-day window used by the health score. |
| `meta` | `snapshot_at` | Recency is computed relative to the data snapshot, not the wall clock. |

## Indexing choices
- `circles(access, last_activity_at)` supports candidate generation (public and recently active) before any scoring.
- `circle_topics(topic_id)` and `circles(topic_id)` are what a topic-first candidate query would use at scale.
- `WITHOUT ROWID` on the pure join tables avoids storing a redundant row id and keeps the primary key as the clustered index.

## Denormalised on purpose
`member_count`, `feed_posts_30d` and `chat_messages_30d` are stored counters on `circles`, as in the source data. Recomputing them per request would be the expensive part of the pipeline. `seed.js` validates referential integrity first and fails with a readable message, and the test suite checks the counters against the `memberships` rows.
