import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = readFileSync(join(HERE, 'schema.sql'), 'utf8');

/**
 * Opens a SQLite database and makes sure the schema exists.
 * Pass ':memory:' for tests.
 * @param {string} path
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase(path) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return db;
}
