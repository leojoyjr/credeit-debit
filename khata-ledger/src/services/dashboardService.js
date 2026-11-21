/**
 * src/services/dashboardService.js
 * Computes business dashboard KPIs:
 * - Total receivable & payable
 * - Net position
 * - Overdue invoice totals
 * - Ageing breakdown (0-30, 31-60, 61-90, 90+ days)
 * - Top 5 debtors & creditors
 * - Recent 10 transactions
 */

const { listParties } = require('./partyService');
const { getOpenInvoices } = require('./transactionService');

function getDaysDifference(fromDateStr, toDateStr) {
  const d1 = new Date(fromDateStr + 'T00:00:00Z');
  const d2 = new Date(toDateStr + 'T00:00:00Z');
  const diffTime = d2.getTime() - d1.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Calculates Ageing buckets (0-30, 31-60, 61-90, 90+ days)
 * @param {'receivable'|'payable'} type
 * @param {string} asOfDate - YYYY-MM-DD
 * @param {Object} db
 */
function calculateAgeingReport(type = 'receivable', asOfDate = null, db) {
  const today = asOfDate || new Date().toISOString().slice(0, 10);
  const partyTypeFilter = type === 'receivable' ? 'customer' : 'supplier';

  // Fetch relevant parties
  const parties = listParties({ is_active: 1 }, db).filter((p) => {
    if (type === 'receivable') {
      return (p.type === 'customer' || p.type === 'both') && p.customer_balance_cents > 0;
    } else {
      return (p.type === 'supplier' || p.type === 'both') && p.supplier_balance_cents > 0;
    }
  });

  const buckets = {
    bucket_0_30: 0,
    bucket_31_60: 0,
    bucket_61_90: 0,
    bucket_90_plus: 0,
    total_cents: 0,
    parties: [],
  };

  for (const party of parties) {
    const invoices = getOpenInvoices(party.id, db).filter((inv) => {
      if (type === 'receivable') return inv.type === 'credit_sale' && inv.remaining_cents > 0;
      return inv.type === 'credit_purchase' && inv.remaining_cents > 0;
    });

    const partyBuckets = {
      party_id: party.id,
      party_name: party.name,
      party_phone: party.phone,
      total_balance_cents: type === 'receivable' ? party.customer_balance_cents : party.supplier_balance_cents,
      b0_30: 0,
      b31_60: 0,
      b61_90: 0,
      b90_plus: 0,
    };

    let accountedInInvoices = 0;

    for (const inv of invoices) {
      const days = getDaysDifference(inv.date, today);
      const remaining = inv.remaining_cents;
      accountedInInvoices += remaining;

      if (days <= 30) {
        partyBuckets.b0_30 += remaining;
        buckets.bucket_0_30 += remaining;
      } else if (days <= 60) {
        partyBuckets.b31_60 += remaining;
        buckets.bucket_31_60 += remaining;
      } else if (days <= 90) {
        partyBuckets.b61_90 += remaining;
        buckets.bucket_61_90 += remaining;
      } else {
        partyBuckets.b90_plus += remaining;
        buckets.bucket_90_plus += remaining;
      }
    }

    // If there is an opening balance or unallocated balance not covered by specific invoices
    const totalBalance = type === 'receivable' ? party.customer_balance_cents : party.supplier_balance_cents;
    const unallocated = totalBalance - accountedInInvoices;
    if (unallocated > 0) {
      // Historical opening balance falls into 90+ days
      partyBuckets.b90_plus += unallocated;
      buckets.bucket_90_plus += unallocated;
    }

    buckets.total_cents += totalBalance;
    buckets.parties.push(partyBuckets);
  }

  return buckets;
}

/**
 * Returns overall dashboard summary.
 */
function getDashboardSummary(db) {
  const allParties = listParties({ is_active: 1 }, db);
  const today = new Date().toISOString().slice(0, 10);

  let totalReceivable = 0;
  let totalPayable = 0;

  const debtors = [];
  const creditors = [];

  for (const party of allParties) {
    if (party.customer_balance_cents > 0) {
      totalReceivable += party.customer_balance_cents;
      debtors.push({
        id: party.id,
        name: party.name,
        phone: party.phone,
        type: party.type,
        amount_cents: party.customer_balance_cents,
      });
    }

    if (party.supplier_balance_cents > 0) {
      totalPayable += party.supplier_balance_cents;
      creditors.push({
        id: party.id,
        name: party.name,
        phone: party.phone,
        type: party.type,
        amount_cents: party.supplier_balance_cents,
      });
    }
  }

  // Sort top 5 debtors and creditors descending by balance
  debtors.sort((a, b) => b.amount_cents - a.amount_cents);
  creditors.sort((a, b) => b.amount_cents - a.amount_cents);

  const topDebtors = debtors.slice(0, 5);
  const topCreditors = creditors.slice(0, 5);

  // Calculate overdue amounts across open invoices
  const overdueRow = db.prepare(`
    SELECT t.id, t.amount_cents, t.party_id
    FROM transactions t
    WHERE t.type = 'credit_sale'
      AND t.due_date IS NOT NULL
      AND t.due_date < ?
      AND t.reversed_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM transactions rev WHERE rev.reversed_of_id = t.id
      )
  `).all(today);

  let totalOverdue = 0;
  for (const inv of overdueRow) {
    const allocRow = db.prepare(`
      SELECT COALESCE(SUM(allocated_cents), 0) AS total_allocated
      FROM transaction_allocations
      WHERE invoice_tx_id = ?
    `).get(inv.id);
    const allocated = Number(allocRow ? allocRow.total_allocated : 0);
    const remaining = Math.max(0, inv.amount_cents - allocated);
    totalOverdue += remaining;
  }

  // Recent 10 transactions
  const recentTransactions = db.prepare(`
    SELECT t.*, p.name as party_name, p.type as party_type, u.name as created_by_name
    FROM transactions t
    JOIN parties p ON t.party_id = p.id
    LEFT JOIN users u ON t.created_by = u.id
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT 10
  `).all();

  // Ageing reports
  const receivablesAgeing = calculateAgeingReport('receivable', today, db);
  const payablesAgeing = calculateAgeingReport('payable', today, db);

  return {
    as_of_date: today,
    kpis: {
      total_receivable_cents: totalReceivable,
      total_payable_cents: totalPayable,
      net_position_cents: totalReceivable - totalPayable,
      total_overdue_cents: totalOverdue,
      active_parties_count: allParties.length,
    },
    top_debtors: topDebtors,
    top_creditors: topCreditors,
    recent_transactions: recentTransactions,
    ageing: {
      receivables: receivablesAgeing,
      payables: payablesAgeing,
    },
  };
}

module.exports = {
  getDaysDifference,
  calculateAgeingReport,
  getDashboardSummary,
};
