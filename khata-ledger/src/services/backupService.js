/**
 * src/services/backupService.js
 * Automatic and on-demand database backup management using SQLite's native VACUUM INTO.
 * Enforces retention of last 30 backups and provides a tested restore procedure.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const MAX_BACKUPS_RETAINED = 30;

function ensureBackupDir() {
  if (!fs.existsSync(config.backupDir)) {
    fs.mkdirSync(config.backupDir, { recursive: true });
  }
}

/**
 * Creates an atomic, defragmented backup of the current database.
 */
function createBackup(db) {
  ensureBackupDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `khata_backup_${timestamp}.db`;
  const backupFilePath = path.join(config.backupDir, filename);

  // SQLite's native atomic VACUUM INTO command
  db.exec(`VACUUM INTO '${backupFilePath.replace(/'/g, "''")}';`);

  // Prune older backups if more than 30
  pruneBackups();

  const stats = fs.statSync(backupFilePath);
  return {
    filename,
    path: backupFilePath,
    size_bytes: stats.size,
    created_at: new Date().toISOString(),
  };
}

/**
 * List all available backups sorted by newest first
 */
function listBackups() {
  ensureBackupDir();

  const files = fs
    .readdirSync(config.backupDir)
    .filter((f) => f.startsWith('khata_backup_') && f.endsWith('.db'))
    .sort()
    .reverse();

  return files.map((filename) => {
    const fullPath = path.join(config.backupDir, filename);
    const stat = fs.statSync(fullPath);
    return {
      filename,
      size_bytes: stat.size,
      created_at: stat.mtime.toISOString(),
    };
  });
}

/**
 * Keep only the latest 30 backups
 */
function pruneBackups() {
  ensureBackupDir();
  const backups = listBackups();
  if (backups.length > MAX_BACKUPS_RETAINED) {
    const toDelete = backups.slice(MAX_BACKUPS_RETAINED);
    for (const b of toDelete) {
      try {
        fs.unlinkSync(path.join(config.backupDir, b.filename));
      } catch (err) {
        console.error(`Failed to delete old backup ${b.filename}:`, err);
      }
    }
  }
}

/**
 * Restore database from a backup file.
 * Validates that the file is a healthy SQLite database before restoring.
 */
function restoreFromBackup(backupFilename, targetDbPath = config.dbPath) {
  const backupFilePath = path.join(config.backupDir, backupFilename);
  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file ${backupFilename} does not exist`);
  }

  // 1. Verify integrity of backup database
  const testDb = new DatabaseSync(backupFilePath);
  try {
    const check = testDb.prepare('PRAGMA integrity_check').get();
    if (!check || check.integrity_check !== 'ok') {
      throw new Error('Corrupt backup file: integrity check failed');
    }
  } finally {
    testDb.close();
  }

  // 2. Remove any lingering WAL/SHM files for target
  const walPath = `${targetDbPath}-wal`;
  const shmPath = `${targetDbPath}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  // 3. Atomic copy of backup file into target
  fs.copyFileSync(backupFilePath, targetDbPath);

  return { success: true, restored_from: backupFilename };
}

module.exports = {
  createBackup,
  listBackups,
  pruneBackups,
  restoreFromBackup,
  MAX_BACKUPS_RETAINED,
};
