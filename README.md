# Circle Recommendations API

Returns a ranked list of Circles a member should join, with a short member-facing explanation for each.

- Design doc (1 page): [`docs/DESIGN.md`](docs/DESIGN.md)
- Database schema and indexing rationale: [`docs/SCHEMA.md`](docs/SCHEMA.md)

## Quick start

Requires **Node 20+** (developed on 22). No external services.

```bash
npm install
npm run seed     # optional: the server auto-seeds on first start
npm start        # http://localhost:3000
npm test         # 43 tests
npm run demo     # prints the four planted scenarios to the console
```

```bash
curl "localhost:3000/users/7/recommendations"
curl "localhost:3000/users/23/recommendations?limit=10&debug=true"
```

| Env var | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | Listen address |
| `DB_PATH` | `var/circles.db` | SQLite file |
| `DATA_DIR` | `data/` | Seed JSON location |

## API

`GET /users/:userId/recommendations?limit=5&debug=false`

| Param | Rules |
| --- | --- |
| `limit` | integer 1-20, default 5 |
| `debug` | boolean; adds per-result score breakdown and the list of excluded Circles with reasons |

Unknown query params, a non-integer user id, or an out-of-range limit return `400`. An unknown user returns `404`.

```jsonc
{
  "user_id": 23,
  "strategy": "personalized",          // personalized | inferred | cold_start
  "as_of": "2026-09-21T00:00:00.000Z", // snapshot time used for recency
  "recommendations": [{
    "rank": 1,
    "circle": { "id": 22, "name": "Level Up Collective", "topic": { "slug": "getting-promoted", "label": "Getting promoted" },
                "format": "hybrid", "join_policy": "request", "member_count": 14, "max_members": 20, "spots_left": 6,
                "cover_image_url": "...", "description": "...", "slug": "..." },
    "score": 0.831,
    "explanation": "Matches your interest in getting promoted. Very active, with 8 posts in the last 30 days, and join requests are reviewed by its leaders.",
    "reasons": [{ "type": "interest_match", "topics": ["getting-promoted"], "source": "stated" }, { "type": "active", "posts_30d": 8 }],
    "similar_circles": []                // near-duplicates collapsed into this result
  }]
}
```

`reasons` is the structured form of the explanation, so a client can render chips instead of prose.

## The four planted scenarios

| Scenario | User | Result |
| --- | --- | --- |
| Cold start | 42 | `cold_start` strategy. Active, open, reasonably sized Circles on broad topics. Copy makes no personal claim. Life-stage Circles are never suggested. |
| Obvious matches | 7 | `#5 Women Who Lead`, then `#6 Speak Up Circle`. |
| Duplicates | 15 | Exactly one of `#10/#11/#12` appears; the other two are listed under `similar_circles`. `#13`, which covers both of her interests, ranks alongside it. |
| Full / inactive | 23 | `#22 Level Up Collective` leads. `#20` (full) and `#21` (dormant and unlisted) are excluded; `debug=true` shows why. |

## Code layout

```
src/
  config.js            env config + POLICY (every tunable weight/threshold in one place)
  service.js           the pipeline: profile -> eligibility -> score -> dedupe -> explain
  domain/              pure functions, no I/O
    interestProfile.js   weighted topic vector from stated / joined / related / bio signals
    eligibility.js       hard gates (full, dormant, unlisted, joined, sensitive, no topic)
    activity.js          "health" score
    scoring.js           relevance, availability, size, final blend
    diversity.js         near-duplicate collapse
    explain.js           member-facing copy + structured reasons
    topics.js            curated related-topics map, bio keyword rules
  db/                  schema.sql, connection, seed (validated, idempotent), repository (read queries)
  http/app.js          Fastify routes, validation, error mapping
test/                  unit tests (domain) + integration tests (HTTP, all 100 users)
```

## Data observations that shaped the design

- **Circle 21** is both dormant and unlisted. Debug output reports every failing rule, not just the first.
- **Circles 27 and 28** have no topic, tags or description. We cannot match or honestly explain them, so they are excluded; this is the first thing I would revisit with richer metadata.
- **Circle 17** lists a tag twice; the composite key de-duplicates it on load.
- **Recency is measured from the dataset's newest timestamp** (`snapshot_at`), not the wall clock. Otherwise every Circle would look stale as time passes.
- `activity.json` is the source for engagement and poster breadth; `feed_posts_30d` stays the source of truth for volume. If post rows are missing, health falls back to a neutral value rather than penalising the Circle.

## Working with AI

I built this with Claude as a pairing partner for design, code and tests, and treated its output as a draft to verify, not to trust. Running the tests caught two real problems that I then fixed: relevance scoring was clamped so a Circle matching two interests got no credit over one, and Fastify silently stripped unknown query parameters instead of rejecting them. I also changed the scenario assertion for user 15 on purpose once the scoring was fixed, because the new order was the better product outcome.
