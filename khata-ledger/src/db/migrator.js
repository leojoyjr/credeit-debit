/**
 * src/db/migrator.js
 * Lightweight schema migration runner. Reads migration files from migrations/
 * and tracks applied migrations in the schema_migrations table.
 */
const fs = require('node:fs');
const path = require('node:path');
const { getDb, transaction } = require('./index');

function runMigrations(db = getDb()) {
  const migrationsDir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(migrationsDir)) return;

  // 1. Ensure migrations table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
  `);

  // 2. Read already applied migrations
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const appliedVersions = new Set(appliedRows.map((r) => r.version));

  // 3. Find migration files (sorted by filename: 001_..., 002_...)
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const versionMatch = file.match(/^(\d+)_/);
    if (!versionMatch) continue;
    const version = parseInt(versionMatch[1], 10);

    if (!appliedVersions.has(version)) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      transaction((txDb) => {
        txDb.exec(sql);
        const insert = txDb.prepare(
          'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
        );
        insert.run(version, file);
      }, db);
      console.log(`[Database] Applied migration ${file}`);
    }
  }
}

module.exports = { runMigrations };
