// Prints recommendations for the four planted scenarios so reviewers can eyeball them.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/connection.js';
import { createRepository } from '../src/db/repository.js';
import { recommendCircles } from '../src/service.js';
import { loadConfig } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(loadConfig(ROOT).dbPath);
const repo = createRepository(db);

const SCENARIOS = [
  [42, 'Cold start: no memberships, no interests, empty profile'],
  [7, 'Obvious matches: leadership-skills + public-speaking'],
  [15, 'Duplicates: negotiation (Circles 10/11/12 are near-identical)'],
  [23, 'Full / inactive: getting-promoted (20 is full, 21 is dormant)'],
];

for (const [userId, title] of SCENARIOS) {
  const res = recommendCircles(repo, userId, { limit: 5, debug: true });
  console.log(`\n=== User ${userId} | ${title} | strategy=${res.strategy}`);
  for (const r of res.recommendations) {
    const dupes = r.similar_circles.length ? `  (similar: ${r.similar_circles.map((s) => `#${s.id}`).join(', ')})` : '';
    console.log(`${r.rank}. #${r.circle.id} ${r.circle.name} [${r.score}]${dupes}\n     "${r.explanation}"`);
  }
  const interesting = res.excluded.filter((e) => e.reasons.some((r) => ['full', 'inactive'].includes(r)));
  console.log(`   excluded full/inactive: ${interesting.map((e) => `#${e.circle_id} (${e.reasons.join('+')})`).join(', ')}`);
}
db.close();
