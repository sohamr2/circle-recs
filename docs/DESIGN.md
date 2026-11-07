# Circle Recommendations: Technical Design

## What I built
I built `GET /users/:id/recommendations`. It returns a ranked list of Circles a member should join, each with a short explanation written for the member. Every request follows the same steps: build an interest profile, remove Circles the member should never see, score the rest, collapse near-duplicates, and write the explanation. The stack is Node, Fastify and SQLite. The ranking logic is pure functions with no database access, so it is easy to test and tune.

## How it ranks
I turn what I know about a member into weighted topics. Stated interests count fully, topics of Circles they already joined count about half, related topics count a little, and bio keywords count only when nothing else is known. A Circle's score is 50% topic relevance and 25% activity health. The remainder covers remaining capacity, size, join friction, members the person already shares Circles with, and basic Circle polish. Health blends recency, post volume, chat volume, engagement per post, and how many different people post, so a Circle run by one person does not look like a community. For cold-start members I drop relevance and rank by health, topic demand, size and openness.

## Key decisions
- **Hard filters, not penalties.** Full, dormant (no posts in 30 days or idle over 30 days), unlisted, and already-joined Circles are excluded. Sending someone to a Circle they cannot join, or where nobody posts, costs more trust than ranking can recover.
- **Duplicates.** Circles with the same primary topic compete for the same intent, so only the best earns a slot. The rest appear as `similar_circles`, so nothing is hidden.
- **Sensitive topics.** Working motherhood, career breaks and being the only one are never inferred. They appear only if the member signalled interest, because I did not want a newcomer's first recommendation to assume something about her life.
- **Honest explanations.** "Matches your interest in X" is used only for stated interests. Inferred ones say "Similar to the Circle you joined", and cold-start copy makes no personal claim. Post counts and spots left come from real data.

## Signals I left out
I did not use the profile photo or completeness score. They do not indicate fit, and they would quietly rank newer members lower. Job title is noisy and low-cardinality. Location is what I would add first, but Circles have no location field and a third of members have none.

## Tradeoffs
The weights come from my judgement, and the dataset has no outcome data, so I cannot claim they are optimal. The related-topics map is hand-curated. Recency is measured from the dataset's snapshot date, not today, so a static snapshot does not look stale. Deduplicating by primary topic is coarse, and activity-based scoring favours established Circles over new ones. Each request scores every Circle in memory, which is fine for 40 and wrong for 40,000.

## For production
1. Pull candidates through topic indexes, then score only a few hundred.
2. Precompute activity stats in a batch or stream job, and cache results briefly.
3. Log impressions, joins and dismissals, add a "not interested" control, and measure joins still active after 30 days rather than clicks. Use that data to learn the weights and replace the curated topic map.
4. Boost new Circles so activity does not lock them out, and monitor who gets surfaced.
5. Re-check capacity at join time, since a Circle can fill between recommendation and click.
6. Move to Postgres with replicas, and add structured logs, latency metrics, and alerts on empty or cold-start results.
