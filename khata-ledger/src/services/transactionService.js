/**
 * src/services/transactionService.js
 * Business logic for Transactions (Credit Sales, Payments, Returns, Reversals, Allocations).
 * Strict validations, immutable transactions, role enforcement on reversals.
 */

const { getPartyById } = require('./partyService');

const VALID_TYPES = [
  'credit_sale',
  'payment_received',
  'credit_purchase',
  'payment_made',
  'sales_return',
  'purchase_return',
  'discount',
  'write_off',
  'adjustment'
];

/**
 * Add days to a YYYY-MM-DD date string.
 */
function addDays(dateStr, days) {
  if (!days || days <= 0) return dateStr;
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Create a new transaction with fast-entry validation.
 * @param {Object} data - { party_id, type, amount_cents, date, due_date, reference_no, note, allocations, allow_credit_override }
 * @param {Object} user - { id, role }
 * @param {Object} db - SQLite database instance
 */
function createTransaction(data, user, db) {
  if (!data.party_id) {
    throw new Error('Party is required');
  }

  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(data.party_id);
  if (!party) {
    throw new Error('Party does not exist');
  }
  if (!party.is_active) {
    throw new Error('Cannot add transaction to an inactive party. Please activate the party first.');
  }

  if (!VALID_TYPES.includes(data.type)) {
    throw new Error(`Invalid transaction type: "${data.type}". Must be one of: ${VALID_TYPES.join(', ')}`);
  }

  const amountCents = Math.round(Number(data.amount_cents));
  if (!amountCents || amountCents <= 0 || !Number.isInteger(amountCents)) {
    throw new Error('Amount must be a positive integer in cents');
  }

  const date = data.date ? data.date.trim() : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('Date must be in YYYY-MM-DD format');
  }

  // Auto-fill due_date based on party's payment_terms_days if not provided
  let dueDate = data.due_date ? data.due_date.trim() : null;
  if (!dueDate && party.payment_terms_days > 0 && ['credit_sale', 'credit_purchase'].includes(data.type)) {
    dueDate = addDays(date, party.payment_terms_days);
  }

  // Credit limit check for credit_sale to customers
  if (data.type === 'credit_sale' && party.credit_limit_cents > 0) {
    const fullParty = getPartyById(party.id, db);
    const projectedBalance = fullParty.customer_balance_cents + amountCents;

    if (projectedBalance > party.credit_limit_cents) {
      const isOwner = user && user.role === 'owner';
      if (!data.allow_credit_override || !isOwner) {
        const error = new Error(
          `Credit limit exceeded! Current balance is ${fullParty.customer_balance_cents} cents, limit is ${party.credit_limit_cents} cents. This sale would make balance ${projectedBalance} cents.`
        );
        error.code = 'CREDIT_LIMIT_EXCEEDED';
        error.current_balance_cents = fullParty.customer_balance_cents;
        error.limit_cents = party.credit_limit_cents;
        error.projected_balance_cents = projectedBalance;
        error.can_override = isOwner;
        throw error;
      }
    }
  }

  const referenceNo = data.reference_no ? data.reference_no.trim() : null;
  const note = data.note ? data.note.trim() : null;
  const createdBy = user ? user.id : 1;

  // Insert transaction
  const stmt = db.prepare(`
    INSERT INTO transactions (
      party_id, type, date, due_date, amount_cents,
      reference_no, note, created_by, reversed_of_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);

  const result = stmt.run(
    party.id, data.type, date, dueDate, amountCents,
    referenceNo, note, createdBy
  );

  const txId = Number(result.lastInsertRowid);

  // Handle optional invoice allocations (for payments)
  if (Array.isArray(data.allocations) && data.allocations.length > 0) {
    const allocStmt = db.prepare(`
      INSERT INTO transaction_allocations (payment_tx_id, invoice_tx_id, allocated_cents)
      VALUES (?, ?, ?)
    `);

    let totalAllocated = 0;
    for (const alloc of data.allocations) {
      const allocCents = Math.round(Number(alloc.allocated_cents));
      if (allocCents > 0) {
        allocStmt.run(txId, alloc.invoice_id, allocCents);
        totalAllocated += allocCents;
      }
    }

    if (totalAllocated > amountCents) {
      throw new Error(`Total allocated amount (${totalAllocated} cents) cannot exceed payment amount (${amountCents} cents).`);
    }
  }

  // Audit log entry
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, after_json)
    VALUES (?, 'CREATE_TRANSACTION', 'transactions', ?, ?)
  `);
  auditStmt.run(
    createdBy, txId,
    JSON.stringify({ id: txId, party_id: party.id, type: data.type, amount_cents: amountCents, date })
  );

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
}

/**
 * Reverse an existing transaction.
 * Transactions are NEVER deleted or modified.
 * Only the owner can reverse transactions.
 */
function reverseTransaction(txId, note, user, db) {
  if (!user || user.role !== 'owner') {
    const err = new Error('Permission denied: Only the Owner can reverse transactions');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const original = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!original) {
    throw new Error('Transaction not found');
  }

  if (original.reversed_of_id != null) {
    throw new Error('Cannot reverse a transaction that is already a reversal entry');
  }

  // Check if already reversed
  const existingReversal = db.prepare('SELECT id FROM transactions WHERE reversed_of_id = ?').get(txId);
  if (existingReversal) {
    throw new Error(`Transaction #${txId} has already been reversed by Transaction #${existingReversal.id}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  const reversalNote = note ? note.trim() : `Reversal of Transaction #${original.id}`;
  const refNo = original.reference_no ? `REV-${original.reference_no}` : `REV-${original.id}`;

  const stmt = db.prepare(`
    INSERT INTO transactions (
      party_id, type, date, due_date, amount_cents,
      reference_no, note, created_by, reversed_of_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    original.party_id,
    original.type,
    today,
    null,
    original.amount_cents,
    refNo,
    reversalNote,
    user.id,
    original.id
  );

  const reversalId = Number(result.lastInsertRowid);

  // Audit log
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, before_json, after_json)
    VALUES (?, 'REVERSE_TRANSACTION', 'transactions', ?, ?, ?)
  `);
  auditStmt.run(
    user.id, reversalId,
    JSON.stringify({ reversed_tx_id: original.id, amount_cents: original.amount_cents }),
    JSON.stringify({ reversal_id: reversalId })
  );

  return db.prepare('SELECT * FROM transactions WHERE id = ?').get(reversalId);
}

/**
 * Get open and partly paid invoices for a party, with allocation tracking.
 */
function getOpenInvoices(partyId, db) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(partyId);
  if (!party) return [];

  // Determine invoice transaction types based on party type
  // Customer invoices = credit_sale; Supplier bills = credit_purchase
  const invoiceTypes = "('credit_sale', 'credit_purchase')";

  const today = new Date().toISOString().slice(0, 10);

  // Find all invoice transactions that have not been reversed
  const invoices = db.prepare(`
    SELECT t.*
    FROM transactions t
    WHERE t.party_id = ?
      AND t.type IN ${invoiceTypes}
      AND t.reversed_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM transactions rev WHERE rev.reversed_of_id = t.id
      )
    ORDER BY t.date ASC, t.id ASC
  `).all(partyId);

  // For each invoice, sum allocations from non-reversed payments
  const results = [];
  for (const inv of invoices) {
    const allocRow = db.prepare(`
      SELECT COALESCE(SUM(a.allocated_cents), 0) AS total_allocated
      FROM transaction_allocations a
      JOIN transactions p ON a.payment_tx_id = p.id
      WHERE a.invoice_tx_id = ?
        AND p.reversed_of_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM transactions rev WHERE rev.reversed_of_id = p.id
        )
    `).get(inv.id);

    const allocatedCents = Number(allocRow ? allocRow.total_allocated : 0);
    const remainingCents = Math.max(0, inv.amount_cents - allocatedCents);

    let status = 'open';
    if (remainingCents === 0) {
      status = 'paid';
    } else if (allocatedCents > 0) {
      status = 'partly_paid';
    } else if (inv.due_date && inv.due_date < today) {
      status = 'overdue';
    }

    results.push({
      ...inv,
      allocated_cents: allocatedCents,
      remaining_cents: remainingCents,
      status,
      is_overdue: inv.due_date ? inv.due_date < today && remainingCents > 0 : false,
    });
  }

  return results;
}

module.exports = {
  createTransaction,
  reverseTransaction,
  getOpenInvoices,
  addDays,
  VALID_TYPES,
};
