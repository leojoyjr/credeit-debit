/**
 * src/routes/reportRoutes.js
 * Endpoints for CSV exports, CSV import preview & commit (Owner only).
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const {
  exportPartiesCsv,
  exportTransactionsCsv,
  exportAgeingCsv,
  previewPartiesImport,
  commitPartiesImport,
} = require('../services/reportService');
const { requireAuth, requireOwner } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireOwner);

// CSV Export: Parties
router.get('/parties/csv', (req, res, next) => {
  try {
    const db = getDb();
    const csv = exportPartiesCsv(db);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="khata_parties.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// CSV Export: Transactions
router.get('/transactions/csv', (req, res, next) => {
  try {
    const db = getDb();
    const options = {
      party_id: req.query.party_id,
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    };
    const csv = exportTransactionsCsv(options, db);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="khata_transactions.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// CSV Export: Ageing
router.get('/ageing/csv', (req, res, next) => {
  try {
    const db = getDb();
    const type = req.query.type || 'receivable';
    const asOfDate = req.query.as_of_date || null;
    const csv = exportAgeingCsv(type, asOfDate, db);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="khata_ageing_${type}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

// CSV Import: Preview
router.post('/parties/preview', express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }), (req, res, next) => {
  try {
    const csvText = typeof req.body === 'string' ? req.body : (req.body.csv_text || '');
    if (!csvText) throw new Error('No CSV content provided');
    const preview = previewPartiesImport(csvText);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

// CSV Import: Commit
router.post('/parties/import', express.json(), (req, res, next) => {
  try {
    const db = getDb();
    const { valid_rows } = req.body;
    if (!Array.isArray(valid_rows) || valid_rows.length === 0) {
      throw new Error('No validated rows provided for import');
    }
    const result = commitPartiesImport(valid_rows, req.user, db);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
