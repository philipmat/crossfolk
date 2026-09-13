import {DatabaseSync} from 'node:sqlite';
import * as fsSync from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const MIGRATIONS_DIR = resolve(fileURLToPath(new URL('../migrations/', import.meta.url)));

function migrationVersion(name) {
  return name.slice(0, name.indexOf('_'));
}

/** Open the shared application database and apply all committed migrations. */
export function openApplicationDatabase(filePath = process.env.APP_DB_PATH || resolve('.local/crossfolk.sqlite'), {migrationsDir = MIGRATIONS_DIR} = {}) {
  const path = resolve(filePath);
  // DatabaseSync is synchronous by design; mkdirSync is intentionally kept in the
  // Node-only adapter so the portable request core remains Web-runtime compatible.
  fsSync.mkdirSync(dirname(path), {recursive: true});
  const connection = new DatabaseSync(path);
  connection.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const database = {connection, path, migrationsDir, applyMigrations() {}, close() {connection.close();}};
  database.applyMigrations = applyMigrations.bind(null, database);
  database.applyMigrations();
  return database;
}

export function applyMigrations(database) {
  const {connection, migrationsDir} = database;
  connection.exec('BEGIN IMMEDIATE');
  try {
    connection.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at_ms INTEGER NOT NULL);');
    const applied = new Set(connection.prepare('SELECT version FROM schema_migrations').all().map((row) => row.version));
    const names = fsSync.readdirSync(migrationsDir).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();

    for (const name of names) {
      const version = migrationVersion(name);
      if (applied.has(version)) continue;
      const sql = fsSync.readFileSync(resolve(migrationsDir, name), 'utf8');
      connection.exec(sql);
      connection.prepare('INSERT INTO schema_migrations (version, applied_at_ms) VALUES (?, ?)').run(version, Date.now());
    }
    connection.exec('COMMIT');
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

export function closeApplicationDatabase(database) {
  database?.close();
}
