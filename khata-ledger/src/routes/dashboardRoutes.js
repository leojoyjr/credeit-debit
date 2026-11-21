/**
 * src/routes/dashboardRoutes.js
 * Endpoints for dashboard metrics, ageing buckets, and monthly summary.
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const { getDashboardSummary } = require('../services/dashboardService');
const { getMonthlySummary } = require('../services/reportService');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const summary = getDashboardSummary(db);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/monthly-summary', (req, res, next) => {
  try {
    const db = getDb();
    const now = new Date();
    const year = req.query.year || now.getFullYear();
    const month = req.query.month || (now.getMonth() + 1);
    const summary = getMonthlySummary(year, month, db);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
