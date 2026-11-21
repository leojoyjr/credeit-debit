/**
 * tests/backup.test.js
 * Unit tests for SQLite database backup creation, retention pruning, and restore verification.
 */
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');
const { createBackup, listBackups, restoreFromBackup } = require('../src/services/backupService');

describe('Database Backup & Restore Tests', () => {
  const testDbPath = path.resolve(__dirname, 'test_backup_source.db');
  const targetDbPath = path.resolve(__dirname, 'test_restored.db');
  let db;

  beforeEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);

    db = new DatabaseSync(testDbPath);
    db.exec(`
      CREATE TABLE test_data (id INTEGER PRIMARY KEY, note TEXT);
      INSERT INTO test_data (note) VALUES ('Initial state note');
    `);
  });

  afterEach(() => {
    try { db.close(); } catch (e) {}
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);
    // Cleanup generated backups in config.backupDir
    if (fs.existsSync(config.backupDir)) {
      const files = fs.readdirSync(config.backupDir);
      for (const f of files) {
        if (f.startsWith('khata_backup_')) {
          fs.unlinkSync(path.join(config.backupDir, f));
        }
      }
    }
  });

  test('Creates a valid backup file with VACUUM INTO', () => {
    const backup = createBackup(db);
    assert.ok(backup.filename);
    assert.ok(fs.existsSync(backup.path));
    assert.ok(backup.size_bytes > 0);

    const backups = listBackups();
    assert.ok(backups.length >= 1);
    assert.equal(backups[0].filename, backup.filename);
  });

  test('Restores data accurately from a backup file', () => {
    const backup = createBackup(db);

    // Modify the live DB after backup
    db.exec("INSERT INTO test_data (note) VALUES ('Added after backup');");
    const countAfter = db.prepare('SELECT COUNT(*) as cnt FROM test_data').get().cnt;
    assert.equal(countAfter, 2);

    // Restore from the backup into targetDbPath
    const restoreRes = restoreFromBackup(backup.filename, targetDbPath);
    assert.equal(restoreRes.success, true);

    // Open targetDbPath to verify original state
    const restoredDb = new DatabaseSync(targetDbPath);
    const restoredRows = restoredDb.prepare('SELECT * FROM test_data').all();
    restoredDb.close();

    assert.equal(restoredRows.length, 1);
    assert.equal(restoredRows[0].note, 'Initial state note');
  });
});
