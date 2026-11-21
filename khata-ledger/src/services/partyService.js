/**
 * src/services/partyService.js
 * Business logic for Parties (Customers, Suppliers, Both).
 * All money is handled in integer cents.
 * Balances are ALWAYS calculated dynamically, never stored.
 */

/**
 * Calculate the net balance effect of a transaction.
 *
 * For Customers:
 *   Positive (+) means they owe us money.
 *   Negative (-) means they have credit / advance payment with us.
 *   - credit_sale: +
 *   - payment_received: -
 *   - sales_return: -
 *   - discount: -
 *   - write_off: -
 *   - adjustment (debit): +
 *   - adjustment (credit): -
 *
 * For Suppliers:
 *   Positive (+) means we owe them money.
 *   Negative (-) means we have advance paid to them.
 *   - credit_purchase: +
 *   - payment_made: -
 *   - purchase_return: -
 *   - discount: -
 *   - adjustment (credit): +
 *   - adjustment (debit): -
 */
function getTransactionCustomerDelta(tx) {
  // If this transaction is a reversal, it reverses the original transaction's effect
  const isReversal = tx.reversed_of_id != null;
  const factor = isReversal ? -1 : 1;

  switch (tx.type) {
    case 'credit_sale':
      return factor * tx.amount_cents;
    case 'payment_received':
    case 'sales_return':
    case 'discount':
    case 'write_off':
      return factor * -tx.amount_cents;
    case 'adjustment':
      // Adjustment note or reference can specify direction; default to customer debit if note contains "debit" or default
      return factor * (tx.note && tx.note.toLowerCase().includes('credit') ? -tx.amount_cents : tx.amount_cents);
    default:
      return 0; // supplier types don't affect customer ledger
  }
}

function getTransactionSupplierDelta(tx) {
  const isReversal = tx.reversed_of_id != null;
  const factor = isReversal ? -1 : 1;

  switch (tx.type) {
    case 'credit_purchase':
      return factor * tx.amount_cents;
    case 'payment_made':
    case 'purchase_return':
    case 'discount':
      return factor * -tx.amount_cents;
    case 'adjustment':
      return factor * (tx.note && tx.note.toLowerCase().includes('debit') ? -tx.amount_cents : tx.amount_cents);
    default:
      return 0; // customer types don't affect supplier ledger
  }
}

/**
 * Calculates current balances for a party:
 * Returns:
 * {
 *   customer_balance_cents, // positive = they owe us, negative = advance credit
 *   supplier_balance_cents, // positive = we owe them, negative = advance paid
 *   net_balance_cents       // for 'both': customer_balance - supplier_balance
 * }
 */
function calculatePartyBalances(party, transactions = []) {
  let customerBalance = 0;
  let supplierBalance = 0;

  // Opening balance setup
  if (party.type === 'customer') {
    customerBalance = party.opening_balance_cents;
  } else if (party.type === 'supplier') {
    supplierBalance = party.opening_balance_cents;
  } else if (party.type === 'both') {
    // If party is both, opening_balance_cents defaults to customer side unless specified
    customerBalance = party.opening_balance_cents;
  }

  // Find IDs of original transactions that have been reversed
  const reversedOriginalIds = new Set();
  for (const tx of transactions) {
    if (tx.reversed_of_id) {
      reversedOriginalIds.add(tx.reversed_of_id);
    }
  }

  // Iterate over transactions in date order
  for (const tx of transactions) {
    // Both original reversed entries and their reversal entries appear in transactions.
    // In our delta logic:
    // Original tx delta: +X
    // Reversal tx delta: -X
    // Sum = 0.
    // So both can be summed directly, or cancelled out.
    customerBalance += getTransactionCustomerDelta(tx);
    supplierBalance += getTransactionSupplierDelta(tx);
  }

  return {
    customer_balance_cents: customerBalance,
    supplier_balance_cents: supplierBalance,
    net_balance_cents: customerBalance - supplierBalance,
  };
}

/**
 * Get all transactions for a party from SQLite.
 */
function getPartyTransactions(partyId, db) {
  const stmt = db.prepare(`
    SELECT * FROM transactions
    WHERE party_id = ?
    ORDER BY date ASC, id ASC
  `);
  return stmt.all(partyId);
}

/**
 * List parties with dynamic balance calculations, search and filters.
 */
function listParties(filters = {}, db) {
  let sql = 'SELECT * FROM parties WHERE 1=1';
  const params = [];

  if (filters.is_active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(filters.is_active ? 1 : 0);
  }

  if (filters.type && filters.type !== 'all') {
    sql += ' AND type = ?';
    params.push(filters.type);
  }

  if (filters.search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR tax_id LIKE ?)';
    const term = `%${filters.search.trim()}%`;
    params.push(term, term, term);
  }

  sql += ' ORDER BY name ASC';
  const parties = db.prepare(sql).all(...params);

  // Attach calculated balance to each party
  const results = parties.map((party) => {
    const txs = getPartyTransactions(party.id, db);
    const balances = calculatePartyBalances(party, txs);
    return {
      ...party,
      ...balances,
      transaction_count: txs.length,
    };
  });

  // Optional balance status filter
  if (filters.balance_status) {
    return results.filter((p) => {
      if (p.type === 'customer') {
        if (filters.balance_status === 'owes_us') return p.customer_balance_cents > 0;
        if (filters.balance_status === 'advance') return p.customer_balance_cents < 0;
        if (filters.balance_status === 'zero') return p.customer_balance_cents === 0;
      } else if (p.type === 'supplier') {
        if (filters.balance_status === 'we_owe') return p.supplier_balance_cents > 0;
        if (filters.balance_status === 'advance') return p.supplier_balance_cents < 0;
        if (filters.balance_status === 'zero') return p.supplier_balance_cents === 0;
      } else {
        if (filters.balance_status === 'owes_us') return p.net_balance_cents > 0;
        if (filters.balance_status === 'we_owe') return p.net_balance_cents < 0;
        if (filters.balance_status === 'zero') return p.net_balance_cents === 0;
      }
      return true;
    });
  }

  return results;
}

/**
 * Get single party by ID with current balances
 */
function getPartyById(id, db) {
  const party = db.prepare('SELECT * FROM parties WHERE id = ?').get(id);
  if (!party) return null;

  const txs = getPartyTransactions(id, db);
  const balances = calculatePartyBalances(party, txs);
  return {
    ...party,
    ...balances,
    transactions: txs,
  };
}

/**
 * Create a new party.
 */
function createParty(data, userId, db) {
  if (!data.name || !data.name.trim()) {
    throw new Error('Party name is required');
  }
  const type = data.type || 'customer';
  if (!['customer', 'supplier', 'both'].includes(type)) {
    throw new Error('Type must be customer, supplier, or both');
  }

  const openingBalanceCents = Math.round(Number(data.opening_balance_cents) || 0);
  const creditLimitCents = Math.max(0, Math.round(Number(data.credit_limit_cents) || 0));
  const paymentTermsDays = Math.max(0, parseInt(data.payment_terms_days, 10) || 0);

  const stmt = db.prepare(`
    INSERT INTO parties (
      name, type, phone, email, address, tax_id,
      credit_limit_cents, payment_terms_days, opening_balance_cents,
      notes, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const result = stmt.run(
    data.name.trim(),
    type,
    data.phone ? data.phone.trim() : null,
    data.email ? data.email.trim() : null,
    data.address ? data.address.trim() : null,
    data.tax_id ? data.tax_id.trim() : null,
    creditLimitCents,
    paymentTermsDays,
    openingBalanceCents,
    data.notes ? data.notes.trim() : null
  );

  const newId = Number(result.lastInsertRowid);

  // Record audit log
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, after_json)
    VALUES (?, 'CREATE_PARTY', 'parties', ?, ?)
  `);
  auditStmt.run(userId || null, newId, JSON.stringify({ id: newId, name: data.name, type }));

  return getPartyById(newId, db);
}

/**
 * Update party details. Opening balance can only be changed if no transactions exist.
 */
function updateParty(id, data, userId, db) {
  const current = getPartyById(id, db);
  if (!current) throw new Error('Party not found');

  const txCount = current.transactions.length;
  let openingBalance = current.opening_balance_cents;
  if (data.opening_balance_cents !== undefined) {
    if (txCount > 0 && Number(data.opening_balance_cents) !== current.opening_balance_cents) {
      throw new Error('Cannot change opening balance when transactions already exist. Use an adjustment transaction instead.');
    }
    openingBalance = Math.round(Number(data.opening_balance_cents) || 0);
  }

  const name = data.name !== undefined ? data.name.trim() : current.name;
  const type = data.type !== undefined ? data.type : current.type;
  const phone = data.phone !== undefined ? data.phone.trim() : current.phone;
  const email = data.email !== undefined ? data.email.trim() : current.email;
  const address = data.address !== undefined ? data.address.trim() : current.address;
  const taxId = data.tax_id !== undefined ? data.tax_id.trim() : current.tax_id;
  const creditLimitCents = data.credit_limit_cents !== undefined
    ? Math.max(0, Math.round(Number(data.credit_limit_cents) || 0))
    : current.credit_limit_cents;
  const paymentTermsDays = data.payment_terms_days !== undefined
    ? Math.max(0, parseInt(data.payment_terms_days, 10) || 0)
    : current.payment_terms_days;
  const notes = data.notes !== undefined ? data.notes.trim() : current.notes;
  const isActive = data.is_active !== undefined ? (data.is_active ? 1 : 0) : current.is_active;

  const stmt = db.prepare(`
    UPDATE parties SET
      name = ?, type = ?, phone = ?, email = ?, address = ?, tax_id = ?,
      credit_limit_cents = ?, payment_terms_days = ?, opening_balance_cents = ?,
      notes = ?, is_active = ?
    WHERE id = ?
  `);

  stmt.run(
    name, type, phone, email, address, taxId,
    creditLimitCents, paymentTermsDays, openingBalance,
    notes, isActive, id
  );

  // Audit log
  const auditStmt = db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, before_json, after_json)
    VALUES (?, 'UPDATE_PARTY', 'parties', ?, ?, ?)
  `);
  auditStmt.run(userId || null, id, JSON.stringify(current), JSON.stringify({ name, type, isActive }));

  return getPartyById(id, db);
}

/**
 * Deactivate party (Never delete)
 */
function deactivateParty(id, userId, db) {
  return updateParty(id, { is_active: 0 }, userId, db);
}

/**
 * Re-activate party
 */
function activateParty(id, userId, db) {
  return updateParty(id, { is_active: 1 }, userId, db);
}

module.exports = {
  calculatePartyBalances,
  getTransactionCustomerDelta,
  getTransactionSupplierDelta,
  getPartyTransactions,
  listParties,
  getPartyById,
  createParty,
  updateParty,
  deactivateParty,
  activateParty,
};
