/**
 * src/services/reportService.js
 * CSV Import/Export, Monthly Summary, and PDF Statement Generation.
 */

const PDFDocument = require('pdfkit');
const { listParties, createParty } = require('./partyService');
const { getPartyStatement } = require('./ledgerService');
const { calculateAgeingReport } = require('./dashboardService');

// Helper to escape CSV cell
function escapeCsv(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Convert cents to currency string (e.g. 15000 -> "150.00")
function formatMoney(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Export Parties to CSV
 */
function exportPartiesCsv(db) {
  const parties = listParties({}, db);
  const headers = [
    'ID', 'Name', 'Type', 'Phone', 'Email', 'Address', 'Tax ID',
    'Credit Limit', 'Payment Terms (Days)', 'Opening Balance',
    'Customer Balance', 'Supplier Balance', 'Net Balance', 'Status'
  ];

  const rows = [headers.join(',')];
  for (const p of parties) {
    rows.push([
      p.id,
      escapeCsv(p.name),
      p.type,
      escapeCsv(p.phone),
      escapeCsv(p.email),
      escapeCsv(p.address),
      escapeCsv(p.tax_id),
      formatMoney(p.credit_limit_cents),
      p.payment_terms_days,
      formatMoney(p.opening_balance_cents),
      formatMoney(p.customer_balance_cents),
      formatMoney(p.supplier_balance_cents),
      formatMoney(p.net_balance_cents),
      p.is_active ? 'Active' : 'Inactive'
    ].join(','));
  }
  return rows.join('\r\n');
}

/**
 * Export Transactions to CSV
 */
function exportTransactionsCsv(options = {}, db) {
  let sql = `
    SELECT t.*, p.name as party_name, p.type as party_type, u.name as created_by_name
    FROM transactions t
    JOIN parties p ON t.party_id = p.id
    LEFT JOIN users u ON t.created_by = u.id
    WHERE 1=1
  `;
  const params = [];
  if (options.party_id) {
    sql += ' AND t.party_id = ?';
    params.push(options.party_id);
  }
  if (options.from_date) {
    sql += ' AND t.date >= ?';
    params.push(options.from_date);
  }
  if (options.to_date) {
    sql += ' AND t.date <= ?';
    params.push(options.to_date);
  }
  sql += ' ORDER BY t.date DESC, t.id DESC';

  const txs = db.prepare(sql).all(...params);
  const headers = [
    'ID', 'Date', 'Due Date', 'Party Name', 'Party Type', 'Type',
    'Amount', 'Reference No', 'Note', 'Created By', 'Reversed of ID'
  ];

  const rows = [headers.join(',')];
  for (const t of txs) {
    rows.push([
      t.id,
      t.date,
      t.due_date || '',
      escapeCsv(t.party_name),
      t.party_type,
      t.type,
      formatMoney(t.amount_cents),
      escapeCsv(t.reference_no),
      escapeCsv(t.note),
      escapeCsv(t.created_by_name),
      t.reversed_of_id || ''
    ].join(','));
  }
  return rows.join('\r\n');
}

/**
 * Export Ageing Report to CSV
 */
function exportAgeingCsv(type = 'receivable', asOfDate = null, db) {
  const report = calculateAgeingReport(type, asOfDate, db);
  const headers = ['Party ID', 'Party Name', 'Phone', '0-30 Days', '31-60 Days', '61-90 Days', '90+ Days', 'Total Balance'];
  const rows = [headers.join(',')];

  for (const p of report.parties) {
    rows.push([
      p.party_id,
      escapeCsv(p.party_name),
      escapeCsv(p.party_phone),
      formatMoney(p.b0_30),
      formatMoney(p.b31_60),
      formatMoney(p.b61_90),
      formatMoney(p.b90_plus),
      formatMoney(p.total_balance_cents)
    ].join(','));
  }

  // Summary row
  rows.push([
    '', 'TOTAL', '',
    formatMoney(report.bucket_0_30),
    formatMoney(report.bucket_31_60),
    formatMoney(report.bucket_61_90),
    formatMoney(report.bucket_90_plus),
    formatMoney(report.total_cents)
  ].join(','));

  return rows.join('\r\n');
}

/**
 * Parse CSV text into array of objects
 */
function parseCsv(csvText) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple regex for CSV splitting considering quotes
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let charIdx = 0; charIdx < line.length; charIdx++) {
      const char = line[charIdx];
      if (char === '"') {
        if (inQuotes && line[charIdx + 1] === '"') {
          current += '"';
          charIdx++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || '';
    });
    rows.push(rowObj);
  }
  return rows;
}

/**
 * Preview CSV Import for Parties with error detection
 */
function previewPartiesImport(csvText) {
  const rawRows = parseCsv(csvText);
  const validRows = [];
  const errors = [];

  rawRows.forEach((row, index) => {
    const rowNum = index + 2; // header is row 1
    const name = row.name || row.party_name;
    const type = (row.type || 'customer').toLowerCase();

    if (!name || !name.trim()) {
      errors.push({ row: rowNum, error: 'Missing required field: Name' });
      return;
    }

    if (!['customer', 'supplier', 'both'].includes(type)) {
      errors.push({ row: rowNum, error: `Invalid type "${type}". Must be customer, supplier, or both.` });
      return;
    }

    const openingBalance = parseFloat(row.opening_balance || row.opening_balance_cents || '0');
    if (isNaN(openingBalance)) {
      errors.push({ row: rowNum, error: 'Opening balance must be a valid number' });
      return;
    }

    const creditLimit = parseFloat(row.credit_limit || row.credit_limit_cents || '0');
    const paymentTerms = parseInt(row.payment_terms || row.payment_terms_days || '0', 10);

    validRows.push({
      name: name.trim(),
      type,
      phone: row.phone || null,
      email: row.email || null,
      address: row.address || null,
      tax_id: row.tax_id || null,
      opening_balance_cents: Math.round(openingBalance * 100),
      credit_limit_cents: Math.round((creditLimit || 0) * 100),
      payment_terms_days: isNaN(paymentTerms) ? 0 : Math.max(0, paymentTerms),
      notes: row.notes || null,
    });
  });

  return {
    total_rows: rawRows.length,
    valid_count: validRows.length,
    error_count: errors.length,
    valid_rows: validRows,
    errors,
  };
}

/**
 * Commit parsed CSV rows into parties table
 */
function commitPartiesImport(validRows, user, db) {
  const created = [];
  for (const row of validRows) {
    const party = createParty(row, user.id, db);
    created.push(party);
  }
  return { imported_count: created.length };
}

/**
 * Generate monthly financial summary
 */
function getMonthlySummary(year, month, db) {
  const y = parseInt(year, 10);
  const m = String(month).padStart(2, '0');
  const monthPrefix = `${y}-${m}`;

  const txs = db.prepare(`
    SELECT t.*, p.type as party_type
    FROM transactions t
    JOIN parties p ON t.party_id = p.id
    WHERE t.date LIKE ?
      AND t.reversed_of_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM transactions rev WHERE rev.reversed_of_id = t.id
      )
  `).all(`${monthPrefix}%`);

  const summary = {
    month: monthPrefix,
    credit_sales_cents: 0,
    payments_received_cents: 0,
    credit_purchases_cents: 0,
    payments_made_cents: 0,
    sales_returns_cents: 0,
    purchase_returns_cents: 0,
    discounts_given_cents: 0,
    write_offs_cents: 0,
    total_transactions_count: txs.length,
  };

  for (const t of txs) {
    switch (t.type) {
      case 'credit_sale':
        summary.credit_sales_cents += t.amount_cents;
        break;
      case 'payment_received':
        summary.payments_received_cents += t.amount_cents;
        break;
      case 'credit_purchase':
        summary.credit_purchases_cents += t.amount_cents;
        break;
      case 'payment_made':
        summary.payments_made_cents += t.amount_cents;
        break;
      case 'sales_return':
        summary.sales_returns_cents += t.amount_cents;
        break;
      case 'purchase_return':
        summary.purchase_returns_cents += t.amount_cents;
        break;
      case 'discount':
        summary.discounts_given_cents += t.amount_cents;
        break;
      case 'write_off':
        summary.write_offs_cents += t.amount_cents;
        break;
      default:
        break;
    }
  }

  summary.net_sales_cents = summary.credit_sales_cents - summary.sales_returns_cents - summary.discounts_given_cents;
  summary.net_purchases_cents = summary.credit_purchases_cents - summary.purchase_returns_cents;
  summary.net_cash_flow_cents = summary.payments_received_cents - summary.payments_made_cents;

  return summary;
}

/**
 * Generate PDF Statement for a party using pdfkit
 */
function generatePartyPdf(partyId, options, db, res) {
  const statement = getPartyStatement(partyId, options, db);
  const { party, entries } = statement;

  // Fetch business profile settings
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  // Stream PDF to HTTP response
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Statement_${party.name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  // Header: Business Profile
  doc.fontSize(20).font('Helvetica-Bold').text(settings.business_name || 'Khata Ledger', { align: 'center' });
  doc.fontSize(10).font('Helvetica').text('Statement of Account / Khata Book', { align: 'center' });
  doc.moveDown(1);

  // Divider line
  doc.strokeColor('#cccccc').lineWidth(1).moveTo(40, doc.y).lineTo(555, doc.y).stroke();
  doc.moveDown(1);

  // Party & Date details in 2 columns
  const partyY = doc.y;
  doc.font('Helvetica-Bold').fontSize(11).text('Account Details:');
  doc.font('Helvetica').fontSize(10);
  doc.text(`Name: ${party.name}`);
  if (party.phone) doc.text(`Phone: ${party.phone}`);
  if (party.email) doc.text(`Email: ${party.email}`);
  if (party.tax_id) doc.text(`Tax ID: ${party.tax_id}`);
  if (party.address) doc.text(`Address: ${party.address}`);

  // Right column
  doc.font('Helvetica-Bold').fontSize(11).text('Statement Period:', 340, partyY);
  doc.font('Helvetica').fontSize(10);
  doc.text(`From: ${statement.filter.from_date || 'Inception'}`, 340);
  doc.text(`To: ${statement.filter.to_date || new Date().toISOString().slice(0, 10)}`, 340);
  doc.text(`Currency: ${settings.currency_code || 'INR'} (${settings.currency_symbol || '₹'})`, 340);

  doc.moveDown(2);

  // Table header
  const tableTop = Math.max(doc.y, partyY + 80);
  doc.rect(40, tableTop, 515, 20).fill('#2c3e50');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9);
  doc.text('Date', 45, tableTop + 5, { width: 65 });
  doc.text('Type / Ref', 115, tableTop + 5, { width: 140 });
  doc.text('Debit (+)', 260, tableTop + 5, { width: 75, align: 'right' });
  doc.text('Credit (-)', 345, tableTop + 5, { width: 75, align: 'right' });
  doc.text('Balance', 430, tableTop + 5, { width: 120, align: 'right' });

  // Rows
  let y = tableTop + 24;
  doc.font('Helvetica').fontSize(9).fillColor('#333333');

  // Opening balance row
  doc.rect(40, y - 2, 515, 18).fill('#f9f9f9');
  doc.fillColor('#555555');
  doc.text(statement.filter.from_date || '-', 45, y, { width: 65 });
  doc.text('Opening Balance', 115, y, { width: 140 });
  doc.text('-', 260, y, { width: 75, align: 'right' });
  doc.text('-', 345, y, { width: 75, align: 'right' });
  doc.text(formatMoney(statement.opening_balance_cents), 430, y, { width: 120, align: 'right' });
  y += 20;

  for (const entry of entries) {
    if (y > 750) {
      doc.addPage();
      y = 40;
    }

    doc.fillColor(entry.is_reversed ? '#888888' : '#222222');
    const isStrike = entry.is_reversed;
    const typeLabel = (entry.type.replace('_', ' ').toUpperCase()) + (entry.reference_no ? ` (${entry.reference_no})` : '');

    doc.text(entry.date, 45, y, { width: 65, strike: isStrike });
    doc.text(typeLabel, 115, y, { width: 140, strike: isStrike });
    doc.text(entry.debit_cents > 0 ? formatMoney(entry.debit_cents) : '-', 260, y, { width: 75, align: 'right', strike: isStrike });
    doc.text(entry.credit_cents > 0 ? formatMoney(entry.credit_cents) : '-', 345, y, { width: 75, align: 'right', strike: isStrike });
    doc.text(formatMoney(entry.running_balance_cents), 430, y, { width: 120, align: 'right' });

    y += 18;
  }

  // Summary box
  y += 10;
  if (y > 720) {
    doc.addPage();
    y = 40;
  }
  doc.strokeColor('#e0e0e0').rect(40, y, 515, 45).stroke();
  doc.fillColor('#222222').font('Helvetica-Bold').fontSize(10);
  doc.text(`Total Debits: ${settings.currency_symbol || '₹'} ${formatMoney(statement.total_debits_cents)}`, 55, y + 8);
  doc.text(`Total Credits: ${settings.currency_symbol || '₹'} ${formatMoney(statement.total_credits_cents)}`, 55, y + 24);

  const finalBal = statement.closing_balance_cents;
  const balLabel = finalBal >= 0 ? 'Pending Balance' : 'Advance / Credit Balance';
  doc.text(`${balLabel}: ${settings.currency_symbol || '₹'} ${formatMoney(Math.abs(finalBal))}`, 320, y + 16, { align: 'right', width: 220 });

  doc.end();
}

/**
 * Generate shareable reminder text & links (WhatsApp wa.me, mailto)
 */
function generateReminder(partyId, db) {
  const party = getPartyById(partyId, db);
  if (!party) throw new Error('Party not found');

  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const r of settingsRows) settings[r.key] = r.value;

  const symbol = settings.currency_symbol || '₹';
  const balanceCents = party.type === 'supplier' ? party.supplier_balance_cents : party.customer_balance_cents;
  const formattedAmount = `${symbol} ${formatMoney(balanceCents)}`;

  let template = settings.reminder_template || 'Dear {party_name}, an amount of {amount} is pending on your account with {business_name}.';
  const message = template
    .replace(/{party_name}/g, party.name)
    .replace(/{amount}/g, formattedAmount)
    .replace(/{business_name}/g, settings.business_name || 'Khata Ledger');

  let whatsappUrl = null;
  if (party.phone) {
    const cleanPhone = party.phone.replace(/[^0-9]/g, '');
    whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  }

  let mailtoUrl = null;
  if (party.email) {
    const subject = encodeURIComponent(`Payment Reminder - ${settings.business_name || 'Khata Ledger'}`);
    mailtoUrl = `mailto:${party.email}?subject=${subject}&body=${encodeURIComponent(message)}`;
  }

  return {
    party_id: party.id,
    party_name: party.name,
    phone: party.phone,
    email: party.email,
    pending_amount_formatted: formattedAmount,
    message,
    whatsapp_url: whatsappUrl,
    mailto_url: mailtoUrl,
  };
}

module.exports = {
  exportPartiesCsv,
  exportTransactionsCsv,
  exportAgeingCsv,
  previewPartiesImport,
  commitPartiesImport,
  getMonthlySummary,
  generatePartyPdf,
  generateReminder,
  formatMoney,
};
