/**
 * src/routes/ledgerRoutes.js
 * Endpoints for per-party ledger statements, PDF generation, and WhatsApp/mailto reminders.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getPartyStatement } = require('../services/ledgerService');
const { generatePartyPdf, generateReminder } = require('../services/reportService');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// Get statement data (JSON)
router.get('/:partyId', (req, res, next) => {
  try {
    const db = getDb();
    const options = {
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    };
    const statement = getPartyStatement(parseInt(req.params.partyId, 10), options, db);
    res.json(statement);
  } catch (err) {
    next(err);
  }
});

// Download statement as PDF
router.get('/:partyId/pdf', (req, res, next) => {
  try {
    const db = getDb();
    const options = {
      from_date: req.query.from_date,
      to_date: req.query.to_date,
    };
    generatePartyPdf(parseInt(req.params.partyId, 10), options, db, res);
  } catch (err) {
    next(err);
  }
});

// Generate payment reminder message and WhatsApp / email links
router.get('/:partyId/reminder', (req, res, next) => {
  try {
    const db = getDb();
    const reminder = generateReminder(parseInt(req.params.partyId, 10), db);
    res.json(reminder);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
