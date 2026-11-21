/**
 * src/routes/settingsRoutes.js
 * Business profile, tax rate, templates, and immutable audit log viewer (Owner only).
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { listAuditLogs } = require('../services/auditService');
const { requireAuth, requireOwner } = require('../middleware/auth');

router.use(requireAuth);

// Get current settings
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

// Update settings (Owner only)
router.put('/', requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const allowedKeys = [
      'business_name',
      'currency_code',
      'currency_symbol',
      'tax_rate',
      'date_format',
      'reminder_template',
      'invoice_prefix',
      'business_address',
      'business_phone',
      'business_tax_id',
    ];

    const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        stmt.run(key, String(req.body[key]));
      }
    }

    // Audit log
    db.prepare(`
      INSERT INTO audit_log (user_id, action, entity, after_json)
      VALUES (?, 'UPDATE_SETTINGS', 'settings', ?)
    `).run(req.user.id, JSON.stringify(req.body));

    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    next(err);
  }
});

// Audit log viewer (Owner only)
router.get('/audit-logs', requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const logs = listAuditLogs({
      entity: req.query.entity,
      action: req.query.action,
      limit: req.query.limit,
      offset: req.query.offset,
    }, db);
    res.json(logs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
