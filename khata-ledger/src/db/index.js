/**
 * src/db/index.js
 * SQLite connection wrapper using Node.js 22 built-in node:sqlite.
 * Configured with Write-Ahead Logging (WAL) and foreign key constraints.
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const config = require('../config');

let instance = null;

function createConnection(dbPath = config.dbPath) {
  // If it's a file path and not memory, ensure the parent directory exists
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);

  // WAL mode for high concurrency & reliability
  // Foreign keys enabled to enforce relational integrity
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);

  return db;
}

function getDb() {
  if (!instance) {
    instance = createConnection();
  }
  return instance;
}

/**
 * Execute multiple statements in a transaction.
 * If any error is thrown, the transaction is automatically rolled back.
 */
function transaction(fn, db = getDb()) {
  db.exec('BEGIN TRANSACTION;');
  try {
    const result = fn(db);
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (rbErr) {
      // rollback error can happen if transaction was aborted
    }
    throw err;
  }
}

module.exports = {
  createConnection,
  getDb,
  transaction,
};
