/**
 * src/routes/partyRoutes.js
 * Endpoints for managing Parties (Customers, Suppliers, Both).
 */

const express = require('express');
const router = express.Router();
const { getDb } = require('../db');
const {
  listParties,
  getPartyById,
  createParty,
  updateParty,
  deactivateParty,
  activateParty,
} = require('../services/partyService');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

// List parties with filtering and calculated balances
router.get('/', (req, res, next) => {
  try {
    const db = getDb();
    const filters = {
      type: req.query.type,
      search: req.query.search,
      balance_status: req.query.balance_status,
      is_active: req.query.is_active !== undefined ? req.query.is_active === '1' || req.query.is_active === 'true' : true,
    };
    const parties = listParties(filters, db);
    res.json(parties);
  } catch (err) {
    next(err);
  }
});

// Get single party with ledger summary
router.get('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const party = getPartyById(parseInt(req.params.id, 10), db);
    if (!party) return res.status(404).json({ error: 'NOT_FOUND', message: 'Party not found' });
    res.json(party);
  } catch (err) {
    next(err);
  }
});

// Create party
router.post('/', (req, res, next) => {
  try {
    const db = getDb();
    const party = createParty(req.body, req.user.id, db);
    res.status(201).json(party);
  } catch (err) {
    next(err);
  }
});

// Update party
router.put('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const party = updateParty(parseInt(req.params.id, 10), req.body, req.user.id, db);
    res.json(party);
  } catch (err) {
    next(err);
  }
});

// Deactivate party
router.post('/:id/deactivate', (req, res, next) => {
  try {
    const db = getDb();
    const party = deactivateParty(parseInt(req.params.id, 10), req.user.id, db);
    res.json(party);
  } catch (err) {
    next(err);
  }
});

// Activate party
router.post('/:id/activate', (req, res, next) => {
  try {
    const db = getDb();
    const party = activateParty(parseInt(req.params.id, 10), req.user.id, db);
    res.json(party);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
