-- Circle recommendations schema (SQLite). Portable to Postgres with minimal changes:
-- INTEGER PRIMARY KEY -> BIGINT GENERATED, TEXT timestamps -> timestamptz, CHECKs stay as-is.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  label  TEXT NOT NULL,
  domain TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                    INTEGER PRIMARY KEY,
  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  has_photo             INTEGER NOT NULL CHECK (has_photo IN (0, 1)),
  bio                   TEXT,
  job_title             TEXT,
  company               TEXT,
  industry              TEXT,
  location              TEXT,
  joined_at             TEXT NOT NULL,
  profile_completeness  REAL NOT NULL CHECK (profile_completeness BETWEEN 0 AND 1)
);

-- Many-to-many: a member's stated interests. Normalised (not a JSON column) so we can
-- answer "who is interested in topic X" and compute topic demand with an index.
CREATE TABLE IF NOT EXISTS user_topic_interests (
  user_id  INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, topic_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_uti_topic ON user_topic_interests(topic_id);

CREATE TABLE IF NOT EXISTS circles (
  id                INTEGER PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  description       TEXT,
  topic_id          INTEGER REFERENCES topics(id),          -- primary topic, nullable by design
  cover_image_url   TEXT,
  format            TEXT NOT NULL CHECK (format IN ('in_person', 'virtual', 'hybrid')),
  access            TEXT NOT NULL CHECK (access IN ('public', 'unlisted')),
  join_policy       TEXT NOT NULL CHECK (join_policy IN ('open', 'request')),
  max_members       INTEGER CHECK (max_members IS NULL OR max_members > 0),  -- NULL = uncapped
  member_count      INTEGER NOT NULL CHECK (member_count >= 0),              -- denormalised counter
  created_at        TEXT NOT NULL,
  last_activity_at  TEXT NOT NULL,
  feed_posts_30d    INTEGER NOT NULL CHECK (feed_posts_30d >= 0),            -- denormalised aggregate
  chat_messages_30d INTEGER NOT NULL CHECK (chat_messages_30d >= 0)          -- denormalised aggregate
);
-- Candidate generation filters on these before any scoring happens.
CREATE INDEX IF NOT EXISTS idx_circles_candidates ON circles(access, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_circles_topic ON circles(topic_id);

-- Secondary topics ("tags"). All tags resolve into the same taxonomy so topic matching
-- is one code path. Composite PK also de-duplicates repeated tags in the source data.
CREATE TABLE IF NOT EXISTS circle_topics (
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  topic_id  INTEGER NOT NULL REFERENCES topics(id)  ON DELETE CASCADE,
  PRIMARY KEY (circle_id, topic_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_circle_topics_topic ON circle_topics(topic_id);

CREATE TABLE IF NOT EXISTS memberships (
  user_id   INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('member', 'leader')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (user_id, circle_id)        -- serves "circles of user X" (exclusion, inferred interests)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_memberships_circle ON memberships(circle_id, user_id); -- serves co-membership

CREATE TABLE IF NOT EXISTS circle_posts (
  id             INTEGER PRIMARY KEY,
  circle_id      INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  body           TEXT NOT NULL,
  reaction_count INTEGER NOT NULL DEFAULT 0,
  comment_count  INTEGER NOT NULL DEFAULT 0,
  save_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_circle_time ON circle_posts(circle_id, created_at);
