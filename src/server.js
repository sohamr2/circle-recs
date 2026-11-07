import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { seedDatabase } from './db/seed.js';
import { createRepository } from './db/repository.js';
import { buildApp } from './http/app.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = loadConfig(ROOT);

// First run convenience: if the database file doesn't exist yet, create and seed it.
const isFirstRun = !existsSync(config.dbPath);
mkdirSync(dirname(config.dbPath), { recursive: true });
const db = openDatabase(config.dbPath);
if (isFirstRun) {
  const counts = seedDatabase(db, config.dataDir);
  console.log('Seeded database:', counts);
}

const app = buildApp(createRepository(db), { logger: true });

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
