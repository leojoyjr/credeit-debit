/**
 * tests/balance.test.js
 * Unit tests verifying money math and sign conventions.
 * All amounts are in integer cents.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const { createParty, getPartyById } = require('../src/services/partyService');
const { createTransaction } = require('../src/services/transactionService');

describe('Money Math & Balance Calculation Tests', () => {
  let db;
  const owner = { id: 1, role: 'owner' };

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    // Insert a dummy user so foreign keys are satisfied
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (1, 'Admin', 'admin', 'hash', 'owner')").run();
  });

  test('Customer balance: credit sale increases balance (positive = customer owes us)', () => {
    const party = createParty({
      name: 'Ramesh Electronics',
      type: 'customer',
      opening_balance_cents: 10000, // ₹100.00
    }, owner.id, db);

    // Initial balance should be 10000
    let current = getPartyById(party.id, db);
    assert.equal(current.customer_balance_cents, 10000);

    // Add a credit sale of ₹50.00 (5000 cents)
    createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 5000,
      date: '2026-11-20',
    }, owner, db);

    current = getPartyById(party.id, db);
    assert.equal(current.customer_balance_cents, 15000, 'Balance must be 10000 + 5000 = 15000');
  });

  test('Customer balance: payment received decreases balance', () => {
    const party = createParty({
      name: 'Suresh Hardware',
      type: 'customer',
      opening_balance_cents: 20000, // ₹200.00
    }, owner.id, db);

    // Pay ₹150.00 (15000 cents)
    createTransaction({
      party_id: party.id,
      type: 'payment_received',
      amount_cents: 15000,
      date: '2026-11-21',
    }, owner, db);

    const current = getPartyById(party.id, db);
    assert.equal(current.customer_balance_cents, 5000, 'Balance must be 20000 - 15000 = 5000');
  });

  test('Customer advance payment: balance goes negative (advance / credit)', () => {
    const party = createParty({
      name: 'Anil Traders',
      type: 'customer',
      opening_balance_cents: 0,
    }, owner.id, db);

    // Advance payment of ₹500.00 (50000 cents)
    createTransaction({
      party_id: party.id,
      type: 'payment_received',
      amount_cents: 50000,
      date: '2026-11-21',
      note: 'Advance for order',
    }, owner, db);

    const current = getPartyById(party.id, db);
    assert.equal(current.customer_balance_cents, -50000, 'Negative balance indicates advance credit');
  });

  test('Supplier balance: credit purchase increases balance (positive = we owe them)', () => {
    const supplier = createParty({
      name: 'Bharat Paper Mills',
      type: 'supplier',
      opening_balance_cents: 0,
    }, owner.id, db);

    createTransaction({
      party_id: supplier.id,
      type: 'credit_purchase',
      amount_cents: 80000, // ₹800.00
      date: '2026-11-20',
    }, owner, db);

    let current = getPartyById(supplier.id, db);
    assert.equal(current.supplier_balance_cents, 80000, 'We owe supplier 80000 cents');

    // Make a partial payment of ₹300.00 (30000 cents)
    createTransaction({
      party_id: supplier.id,
      type: 'payment_made',
      amount_cents: 30000,
      date: '2026-11-21',
    }, owner, db);

    current = getPartyById(supplier.id, db);
    assert.equal(current.supplier_balance_cents, 50000, 'We owe supplier 50000 cents');
  });

  test('Party with type "both" calculates separate customer and supplier balances and net', () => {
    const dualParty = createParty({
      name: 'Modern Distributors',
      type: 'both',
      opening_balance_cents: 10000, // customer opening balance
    }, owner.id, db);

    // Credit sale to them: ₹300.00
    createTransaction({
      party_id: dualParty.id,
      type: 'credit_sale',
      amount_cents: 30000,
      date: '2026-11-20',
    }, owner, db);

    // Credit purchase from them: ₹250.00
    createTransaction({
      party_id: dualParty.id,
      type: 'credit_purchase',
      amount_cents: 25000,
      date: '2026-11-20',
    }, owner, db);

    const current = getPartyById(dualParty.id, db);
    // Customer balance: 10000 + 30000 = 40000 (they owe us ₹400)
    assert.equal(current.customer_balance_cents, 40000);
    // Supplier balance: 25000 (we owe them ₹250)
    assert.equal(current.supplier_balance_cents, 25000);
    // Net: 40000 - 25000 = 15000 (net they owe us ₹150)
    assert.equal(current.net_balance_cents, 15000);
  });
});
