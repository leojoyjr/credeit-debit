/**
 * tests/allocations.test.js
 * Unit tests for payment allocation to invoices, due date calculations,
 * and tracking open, partly paid, paid, and overdue status.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const { createParty } = require('../src/services/partyService');
const { createTransaction, getOpenInvoices } = require('../src/services/transactionService');

describe('Invoice Allocations & Due Date Status Tests', () => {
  let db;
  const owner = { id: 1, role: 'owner' };

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (1, 'Admin', 'admin', 'hash', 'owner')").run();
  });

  test('Auto-fills due_date based on payment_terms_days', () => {
    const party = createParty({
      name: 'Credit Terms Customer',
      type: 'customer',
      payment_terms_days: 15,
      opening_balance_cents: 0,
    }, owner.id, db);

    const tx = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 10000,
      date: '2026-11-01',
    }, owner, db);

    assert.equal(tx.due_date, '2026-11-16');
  });

  test('Tracks invoice status from open to partly_paid to paid', () => {
    const party = createParty({
      name: 'Invoice Track Party',
      type: 'customer',
      payment_terms_days: 30,
      opening_balance_cents: 0,
    }, owner.id, db);

    // Create an invoice for ₹100.00 (10000 cents)
    const inv = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 10000,
      date: '2026-11-01',
      due_date: '2026-12-01',
      reference_no: 'INV-101',
    }, owner, db);

    // Initially status is open
    let openInvoices = getOpenInvoices(party.id, db);
    assert.equal(openInvoices.length, 1);
    assert.equal(openInvoices[0].id, inv.id);
    assert.equal(openInvoices[0].status, 'open');
    assert.equal(openInvoices[0].remaining_cents, 10000);

    // Make partial payment of ₹40.00 (4000 cents) allocated to this invoice
    createTransaction({
      party_id: party.id,
      type: 'payment_received',
      amount_cents: 4000,
      date: '2026-11-05',
      allocations: [{ invoice_id: inv.id, allocated_cents: 4000 }],
    }, owner, db);

    openInvoices = getOpenInvoices(party.id, db);
    assert.equal(openInvoices[0].status, 'partly_paid');
    assert.equal(openInvoices[0].allocated_cents, 4000);
    assert.equal(openInvoices[0].remaining_cents, 6000);

    // Make remaining payment of ₹60.00 (6000 cents)
    createTransaction({
      party_id: party.id,
      type: 'payment_received',
      amount_cents: 6000,
      date: '2026-11-10',
      allocations: [{ invoice_id: inv.id, allocated_cents: 6000 }],
    }, owner, db);

    openInvoices = getOpenInvoices(party.id, db);
    assert.equal(openInvoices[0].status, 'paid');
    assert.equal(openInvoices[0].remaining_cents, 0);
  });

  test('Overdue status is assigned when due_date < today and invoice has unpaid balance', () => {
    const party = createParty({
      name: 'Overdue Customer',
      type: 'customer',
      opening_balance_cents: 0,
    }, owner.id, db);

    // Past due invoice
    const inv = createTransaction({
      party_id: party.id,
      type: 'credit_sale',
      amount_cents: 25000,
      date: '2026-10-01',
      due_date: '2026-10-15', // Past date
      reference_no: 'INV-OLD',
    }, owner, db);

    const openInvoices = getOpenInvoices(party.id, db);
    assert.equal(openInvoices[0].status, 'overdue');
    assert.equal(openInvoices[0].is_overdue, true);
  });
});
