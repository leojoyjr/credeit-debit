/**
 * src/routes/backupRoutes.js
 * Endpoints for manual database backup, listing, downloading, and restoring (Owner only).
 */

const express = require('express');
const router = express.Router();
const path = require('node:path');
const fs = require('node:fs');
const { getDb } = require('../db');
const config = require('../config');
const {
  createBackup,
  listBackups,
  restoreFromBackup,
} = require('../services/backupService');
const { requireAuth, requireOwner } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireOwner);

// List all backups
router.get('/', (req, res, next) => {
  try {
    const backups = listBackups();
    res.json(backups);
  } catch (err) {
    next(err);
  }
});

// Create manual backup now
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const backup = createBackup(db);

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (user_id, action, entity, after_json)
      VALUES (?, 'MANUAL_BACKUP', 'system', ?)
    `).run(req.user.id, JSON.stringify({ filename: backup.filename, size: backup.size_bytes }));

    res.status(201).json(backup);
  } catch (err) {
    next(err);
  }
});

// Download backup file
router.get('/download/:filename', (req, res, next) => {
  try {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(config.backupDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Backup file not found' });
    }
    res.download(filePath, filename);
  } catch (err) {
    next(err);
  }
});

// Restore from backup
router.post('/restore', (req, res, next) => {
  try {
    const { filename } = req.body;
    if (!filename) throw new Error('Filename is required');

    const result = restoreFromBackup(filename);
    res.json({ message: `Successfully restored database from ${filename}`, result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
