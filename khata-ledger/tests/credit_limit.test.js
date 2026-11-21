/**
 * tests/credit_limit.test.js
 * Unit tests for customer credit limit warnings and owner override.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const { createParty, getPartyById } = require('../src/services/partyService');
const { createTransaction } = require('../src/services/transactionService');

describe('Credit Limit Enforcement & Override Tests', () => {
  let db;
  const owner = { id: 1, role: 'owner' };
  const staff = { id: 2, role: 'staff' };

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (1, 'Admin', 'admin', 'hash', 'owner')").run();
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (2, 'Staff', 'staff', 'hash', 'staff')").run();
  });

  test('Sale within credit limit succeeds smoothly', () => {
    const party = createParty({
      name: 'Safe Customer',
      type: 'customer',
      credit_limit_cents: 50000, // ₹500.00 limit
      opening_balance_cents: 10000,
    }, owner.id, db);

    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 20000, // New total 30000 <= 50000
      date: '2026-11-20',
    }, staff, db);

    assert.ok(tx.id);
    assert.equal(getPartyById(party.id, db).customer_balance_cents, 30000);
  });

  test('Sale exceeding credit limit fails with CREDIT_LIMIT_EXCEEDED', () => {
    const party = createParty({
      name: 'Strict Customer',
      type: 'customer',
      credit_limit_cents: 50000, // ₹500 limit
      opening_balance_cents: 40000,
    }, owner.id, db);

    assert.throws(
      () => {
        createTransaction({
          party_id: party.id,
          type: 'credit_sale',
          amount_cents: 20000, // 40000 + 20000 = 60000 > 50000
          date: '2026-11-20',
        }, staff, db);
      },
      (err) => err.code === 'CREDIT_LIMIT_EXCEEDED'
    );
  });

  test('Staff CANNOT override credit limit even if requested', () => {
    const party = createParty({
      name: 'Staff Check Customer',
      type: 'customer',
      credit_limit_cents: 50000,
      opening_balance_cents: 45000,
    }, owner.id, db);

    assert.throws(
      () => {
        createTransaction({
          party_id: party.id,
          type: 'credit_sale',
          amount_cents: 10000,
          date: '2026-11-20',
          allow_credit_override: true, // Staff attempts override
        }, staff, db);
      },
      (err) => err.code === 'CREDIT_LIMIT_EXCEEDED'
    );
  });

  test('Owner CAN override credit limit when explicitly requested', () => {
    const party = createParty({
      name: 'Owner Override Customer',
      type: 'customer',
      credit_limit_cents: 50000,
      opening_balance_cents: 45000,
    }, owner.id, db);

    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 15000, // 45000 + 15000 = 60000 > 50000
      date: '2026-11-20',
      allow_credit_override: true, // Owner allows override
    }, owner, db);

    assert.ok(tx.id);
    assert.equal(getPartyById(party.id, db).customer_balance_cents, 60000);
  });
});
