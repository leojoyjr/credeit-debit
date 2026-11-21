/**
 * src/services/ledgerService.js
 * Builds full per-party statements with debit/credit entries, running balances,
 * struck-through reversal flags, and date-range filtering.
 */

const { getPartyById } = require('./partyService');

/**
 * Maps a transaction to accounting Debit and Credit amounts for the party statement.
 *
 * For Customers:
 *   - Debit (+): credit_sale, debit adjustment (increases what they owe)
 *   - Credit (-): payment_received, sales_return, discount, write_off, credit adjustment (reduces what they owe)
 *
 * For Suppliers:
 *   - Credit (+): credit_purchase, credit adjustment (increases what we owe)
 *   - Debit (-): payment_made, purchase_return, discount, debit adjustment (reduces what we owe)
 */
function classifyDebitCredit(partyType, tx) {
  const isReversal = tx.reversed_of_id != null;
  let debit = 0;
  let credit = 0;

  if (partyType === 'customer' || partyType === 'both') {
    switch (tx.type) {
      case 'credit_sale':
        if (isReversal) credit = tx.amount_cents;
        else debit = tx.amount_cents;
        break;
      case 'payment_received':
      case 'sales_return':
      case 'discount':
      case 'write_off':
        if (isReversal) debit = tx.amount_cents;
        else credit = tx.amount_cents;
        break;
      case 'credit_purchase':
        if (isReversal) debit = tx.amount_cents;
        else credit = tx.amount_cents;
        break;
      case 'payment_made':
      case 'purchase_return':
        if (isReversal) credit = tx.amount_cents;
        else debit = tx.amount_cents;
        break;
      case 'adjustment':
        const isAdjCredit = tx.note && tx.note.toLowerCase().includes('credit');
        if (isAdjCredit) {
          if (isReversal) debit = tx.amount_cents;
          else credit = tx.amount_cents;
        } else {
          if (isReversal) credit = tx.amount_cents;
          else debit = tx.amount_cents;
        }
        break;
      default:
        break;
    }
  } else {
    // Supplier
    switch (tx.type) {
      case 'credit_purchase':
        if (isReversal) debit = tx.amount_cents;
        else credit = tx.amount_cents;
        break;
      case 'payment_made':
      case 'purchase_return':
      case 'discount':
        if (isReversal) credit = tx.amount_cents;
        else debit = tx.amount_cents;
        break;
      case 'adjustment':
        const isAdjDebit = tx.note && tx.note.toLowerCase().includes('debit');
        if (isAdjDebit) {
          if (isReversal) credit = tx.amount_cents;
          else debit = tx.amount_cents;
        } else {
          if (isReversal) debit = tx.amount_cents;
          else credit = tx.amount_cents;
        }
        break;
      default:
        break;
    }
  }

  return { debit_cents: debit, credit_cents: credit };
}

/**
 * Generate complete ledger statement for a party.
 * Options:
 * - from_date (YYYY-MM-DD)
 * - to_date (YYYY-MM-DD)
 */
function getPartyStatement(partyId, options = {}, db) {
  const party = getPartyById(partyId, db);
  if (!party) throw new Error('Party not found');

  const { from_date, to_date } = options;

  // Fetch all transactions in chronological order to correctly calculate running balance
  const allTxs = db.prepare(`
    SELECT t.*, u.name as created_by_name
    FROM transactions t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.party_id = ?
    ORDER BY t.date ASC, t.id ASC
  `).all(partyId);

  // Map to identify which transactions have been reversed
  const reversedByIdMap = new Map();
  for (const tx of allTxs) {
    if (tx.reversed_of_id) {
      reversedByIdMap.set(tx.reversed_of_id, tx.id);
    }
  }

  let runningBalance = party.opening_balance_cents;
  let openingBalanceForPeriod = runningBalance;
  let totalDebitsPeriod = 0;
  let totalCreditsPeriod = 0;

  const entries = [];

  for (const tx of allTxs) {
    const isReversed = reversedByIdMap.has(tx.id);
    const reversalTxId = reversedByIdMap.get(tx.id) || null;
    const isReversal = tx.reversed_of_id != null;

    const { debit_cents, credit_cents } = classifyDebitCredit(party.type, tx);

    // Update running balance
    // For Customer: Balance = Previous + Debit - Credit
    // For Supplier: Balance = Previous + Credit - Debit
    if (party.type === 'supplier') {
      runningBalance += (credit_cents - debit_cents);
    } else {
      runningBalance += (debit_cents - credit_cents);
    }

    const inDateRange = (!from_date || tx.date >= from_date) && (!to_date || tx.date <= to_date);

    if (from_date && tx.date < from_date) {
      // Transaction is before filter period, so it updates opening balance of period
      openingBalanceForPeriod = runningBalance;
    }

    if (inDateRange) {
      totalDebitsPeriod += debit_cents;
      totalCreditsPeriod += credit_cents;

      entries.push({
        id: tx.id,
        date: tx.date,
        due_date: tx.due_date,
        type: tx.type,
        reference_no: tx.reference_no,
        note: tx.note,
        amount_cents: tx.amount_cents,
        debit_cents,
        credit_cents,
        running_balance_cents: runningBalance,
        is_reversed: isReversed,
        reversed_by_id: reversalTxId,
        reversed_of_id: tx.reversed_of_id,
        created_by_name: tx.created_by_name,
        created_at: tx.created_at,
      });
    }
  }

  return {
    party: {
      id: party.id,
      name: party.name,
      type: party.type,
      phone: party.phone,
      email: party.email,
      address: party.address,
      tax_id: party.tax_id,
      credit_limit_cents: party.credit_limit_cents,
      payment_terms_days: party.payment_terms_days,
      current_balance_cents: party.type === 'supplier' ? party.supplier_balance_cents : party.customer_balance_cents,
      customer_balance_cents: party.customer_balance_cents,
      supplier_balance_cents: party.supplier_balance_cents,
      net_balance_cents: party.net_balance_cents,
    },
    filter: {
      from_date: from_date || null,
      to_date: to_date || null,
    },
    opening_balance_cents: openingBalanceForPeriod,
    total_debits_cents: totalDebitsPeriod,
    total_credits_cents: totalCreditsPeriod,
    closing_balance_cents: runningBalance,
    entries,
  };
}

module.exports = {
  getPartyStatement,
  classifyDebitCredit,
};
