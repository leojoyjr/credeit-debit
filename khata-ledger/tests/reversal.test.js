/**
 * tests/reversal.test.js
 * Unit tests verifying that transactions are immutable, reversals link properly,
 * and balance calculations cancel out reversed entries.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const { createParty, getPartyById } = require('../src/services/partyService');
const { createTransaction, reverseTransaction } = require('../src/services/transactionService');

describe('Transaction Reversal & Immutability Tests', () => {
  let db;
  const owner = { id: 1, role: 'owner' };
  const staff = { id: 2, role: 'staff' };

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (1, 'Admin', 'admin', 'hash', 'owner')").run();
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (2, 'Staff', 'staff', 'hash', 'staff')").run();
  });

  test('Staff user CANNOT reverse a transaction (permission check)', () => {
    const party = createParty({ name: 'Test Party', type: 'customer', opening_balance_cents: 0 }, owner.id, db);
    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 5000,
      date: '2026-11-20',
    }, staff, db);

    assert.throws(
      () => reverseTransaction(tx.id, 'Mistake', staff, db),
      /Permission denied/
    );
  });

  test('Owner reversal negates original transaction and restores balance', () => {
    const party = createParty({ name: 'Alpha Corp', type: 'customer', opening_balance_cents: 10000 }, owner.id, db);

    // Initial balance is 10000
    assert.equal(getPartyById(party.id, db).customer_balance_cents, 10000);

    // Add wrong credit sale of 5000
    const wrongTx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 5000,
      date: '2026-11-20',
    }, owner, db);

    // Balance is now 15000
    assert.equal(getPartyById(party.id, db).customer_balance_cents, 15000);

    // Reverse the wrong transaction
    const reversalTx = reverseTransaction(wrongTx.id, 'Entered wrong amount', owner, db);
    assert.equal(reversalTx.reversed_of_id, wrongTx.id);

    // Balance must be back to 10000!
    const afterReversal = getPartyById(party.id, db);
    assert.equal(afterReversal.customer_balance_cents, 10000);

    // Both transactions still exist in database (no deletions)
    const allTxs = db.prepare('SELECT * FROM transactions WHERE party_id = ?').all(party.id);
    assert.equal(allTxs.length, 2);
  });

  test('Cannot reverse an already reversed transaction', () => {
    const party = createParty({ name: 'Beta Ltd', type: 'customer', opening_balance_cents: 0 }, owner.id, db);
    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 3000,
      date: '2026-11-20',
    }, owner, db);

    reverseTransaction(tx.id, 'First reversal', owner, db);

    assert.throws(
      () => reverseTransaction(tx.id, 'Second reversal', owner, db),
      /already been reversed/
    );
  });

  test('Cannot reverse a transaction that is itself a reversal', () => {
    const party = createParty({ name: 'Gamma Inc', type: 'customer', opening_balance_cents: 0 }, owner.id, db);
    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 3000,
      date: '2026-11-20',
    }, owner, db);

    const reversalTx = reverseTransaction(tx.id, 'Reversal', owner, db);

    assert.throws(
      () => reverseTransaction(reversalTx.id, 'Reverse the reversal', owner, db),
      /already a reversal entry/
    );
  });
});
