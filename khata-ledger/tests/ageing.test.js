/**
 * tests/ageing.test.js
 * Unit tests for Ageing report buckets (0-30, 31-60, 61-90, 90+)
 * and ledger statement generation.
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../src/db/index');
const { runMigrations } = require('../src/db/migrator');
const { createParty } = require('../src/services/partyService');
const { createTransaction, reverseTransaction } = require('../src/services/transactionService');
const { getPartyStatement } = require('../src/services/ledgerService');
const { calculateAgeingReport, getDashboardSummary } = require('../src/services/dashboardService');

describe('Ageing Report & Ledger Statement Tests', () => {
  let db;
  const owner = { id: 1, role: 'owner' };

  beforeEach(() => {
    db = createConnection(':memory:');
    runMigrations(db);
    db.prepare("INSERT INTO users (id, name, username, password_hash, role) VALUES (1, 'Admin', 'admin', 'hash', 'owner')").run();
  });

  test('Calculates ageing buckets correctly according to days elapsed', () => {
    const customer = createParty({
      name: 'Ageing Customer',
      type: 'customer',
      opening_balance_cents: 0,
    }, owner.id, db);

    const asOfDate = '2026-11-20';

    // 10 days old -> bucket 0-30
    createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 10000,
      date: '2026-11-10',
    }, owner, db);

    // 40 days old -> bucket 31-60
    createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 20000,
      date: '2026-10-11',
    }, owner, db);

    // 75 days old -> bucket 61-90
    createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 30000,
      date: '2026-09-06',
    }, owner, db);

    // 100 days old -> bucket 90+
    createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 40000,
      date: '2026-08-12',
    }, owner, db);

    const report = calculateAgeingReport('receivable', asOfDate, db);

    assert.equal(report.bucket_0_30, 10000, '0-30 days bucket should be 10000');
    assert.equal(report.bucket_31_60, 20000, '31-60 days bucket should be 20000');
    assert.equal(report.bucket_61_90, 30000, '61-90 days bucket should be 30000');
    assert.equal(report.bucket_90_plus, 40000, '90+ days bucket should be 40000');
    assert.equal(report.total_cents, 100000, 'Total should equal 100000');
  });

  test('Ledger statement reflects running balance and marks reversed transactions', () => {
    const customer = createParty({
      name: 'Statement Customer',
      type: 'customer',
      opening_balance_cents: 5000, // ₹50.00
    }, owner.id, db);

    // 1. Credit sale ₹100.00
    const tx1 = createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 10000,
      date: '2026-11-01',
      reference_no: 'INV-1',
    }, owner, db);

    // 2. Erroneous credit sale ₹50.00
    const tx2 = createTransaction({
      party_id: customer.id,
      type: 'credit_sale',
      amount_cents: 5000,
      date: '2026-11-02',
      reference_no: 'INV-2',
    }, owner, db);

    // 3. Reverse tx2
    const rev2 = reverseTransaction(tx2.id, 'Wrong entry', owner, db);

    // 4. Payment received ₹80.00
    createTransaction({
      party_id: customer.id,
      type: 'payment_received',
      amount_cents: 8000,
      date: '2026-11-05',
      reference_no: 'PAY-1',
    }, owner, db);

    const statement = getPartyStatement(customer.id, {}, db);

    assert.equal(statement.opening_balance_cents, 5000);
    // Closing balance: 5000 + 10000 (tx1) + 5000 (tx2) - 5000 (rev2) - 8000 (pay1) = 7000
    assert.equal(statement.closing_balance_cents, 7000);

    // Check that tx2 is marked is_reversed
    const entry2 = statement.entries.find((e) => e.id === tx2.id);
    assert.equal(entry2.is_reversed, true);
    assert.equal(entry2.reversed_by_id, rev2.id);

    // Check that rev2 has reversed_of_id
    const entryRev = statement.entries.find((e) => e.id === rev2.id);
    assert.equal(entryRev.reversed_of_id, tx2.id);
  });

  test('Dashboard summary aggregates KPIs, top debtors and recent transactions', () => {
    const debtor = createParty({
      name: 'Debtor Corp',
      type: 'customer',
      opening_balance_cents: 50000,
    }, owner.id, db);

    const creditor = createParty({
      name: 'Supplier Mills',
      type: 'supplier',
      opening_balance_cents: 30000,
    }, owner.id, db);

    const summary = getDashboardSummary(db);

    assert.equal(summary.kpis.total_receivable_cents, 50000);
    assert.equal(summary.kpis.total_payable_cents, 30000);
    assert.equal(summary.kpis.net_position_cents, 20000);
    assert.equal(summary.top_debtors.length, 1);
    assert.equal(summary.top_debtors[0].name, 'Debtor Corp');
    assert.equal(summary.top_creditors.length, 1);
    assert.equal(summary.top_creditors[0].name, 'Supplier Mills');
  });
});
