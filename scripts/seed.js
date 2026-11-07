import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { openDatabase } from '../src/db/connection.js';
import { seedDatabase } from '../src/db/seed.js';
import { loadConfig } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { dbPath, dataDir } = loadConfig(ROOT);

mkdirSync(dirname(dbPath), { recursive: true });
const db = openDatabase(dbPath);
const counts = seedDatabase(db, dataDir);
console.log(`Seeded ${dbPath}`);
console.table(counts);
db.close();
