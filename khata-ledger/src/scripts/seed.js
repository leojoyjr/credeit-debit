/**
 * src/scripts/seed.js
 * Generates realistic demonstration data for Khata Ledger:
 * - 1 Owner account (admin / Admin@12345)
 * - 2 Staff accounts (staff1 / Staff@12345, staff2 / Staff@12345)
 * - 10 Parties (Customers, Suppliers, Both)
 * - 60 Transactions with realistic dates, references, notes, and reversals.
 */

const { getDb } = require('../db');
const { runMigrations } = require('../db/migrator');
const { hashPassword } = require('../services/authService');
const { createParty } = require('../services/partyService');
const { createTransaction, reverseTransaction } = require('../services/transactionService');

function runSeed() {
  const db = getDb();
  runMigrations(db);

  console.log('--- Seeding Khata Ledger Demo Data ---');

  // Check if users already exist
  const existingUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  let ownerId = 1;
  let staff1Id = 2;
  let staff2Id = 3;

  if (existingUsers === 0) {
    const ownerHash = hashPassword('Admin@12345');
    const staffHash = hashPassword('Staff@12345');

    const insertUser = db.prepare(`
      INSERT INTO users (name, username, password_hash, role, is_active)
      VALUES (?, ?, ?, ?, 1)
    `);

    ownerId = Number(insertUser.run('Rajesh Sharma (Owner)', 'admin', ownerHash, 'owner').lastInsertRowid);
    staff1Id = Number(insertUser.run('Vikram Singh (Staff)', 'staff1', staffHash, 'staff').lastInsertRowid);
    staff2Id = Number(insertUser.run('Pooja Patel (Staff)', 'staff2', staffHash, 'staff').lastInsertRowid);

    // Default settings
    const settingStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    settingStmt.run('business_name', 'Sharma Trading Co.');
    settingStmt.run('currency_code', 'INR');
    settingStmt.run('currency_symbol', '₹');
    settingStmt.run('tax_rate', '18');
    settingStmt.run('date_format', 'YYYY-MM-DD');
    settingStmt.run('reminder_template', 'Dear {party_name}, an outstanding balance of {amount} is pending on your ledger with {business_name}. Kindly settle it at your earliest convenience.');

    console.log('Created Demo Accounts:');
    console.log('  Owner: username="admin", password="Admin@12345"');
    console.log('  Staff 1: username="staff1", password="Staff@12345"');
    console.log('  Staff 2: username="staff2", password="Staff@12345"');
  }

  const owner = { id: ownerId, role: 'owner' };
  const staff1 = { id: staff1Id, role: 'staff' };
  const staff2 = { id: staff2Id, role: 'staff' };

  // 10 Realistic Parties
  const demoParties = [
    { name: 'Kavita General Store', type: 'customer', phone: '9820011223', email: 'kavita@store.in', tax_id: '27AAAAA0000A1Z5', credit_limit_cents: 10000000, payment_terms_days: 15, opening_balance_cents: 250000 },
    { name: 'Anil Electricals', type: 'customer', phone: '9820022334', email: 'anil@elec.in', tax_id: '27BBBBB1111B1Z6', credit_limit_cents: 5000000, payment_terms_days: 30, opening_balance_cents: 0 },
    { name: 'Modern Stationery & Xerox', type: 'customer', phone: '9820033445', email: 'modern@xerox.in', tax_id: '', credit_limit_cents: 3000000, payment_terms_days: 7, opening_balance_cents: 120000 },
    { name: 'Balaji Hardware Mart', type: 'customer', phone: '9820044556', email: 'balaji@hardware.in', tax_id: '27CCCCC2222C1Z7', credit_limit_cents: 15000000, payment_terms_days: 30, opening_balance_cents: 850000 },
    { name: 'Ganesh Sweets & Bakers', type: 'customer', phone: '9820055667', email: 'ganesh@sweets.in', tax_id: '', credit_limit_cents: 2000000, payment_terms_days: 15, opening_balance_cents: 0 },
    { name: 'Super Wholesale Distributors', type: 'supplier', phone: '9830011223', email: 'sales@superwhole.in', tax_id: '27DDDDD3333D1Z8', credit_limit_cents: 0, payment_terms_days: 30, opening_balance_cents: 1200000 },
    { name: 'Apex Paper Mills Ltd', type: 'supplier', phone: '9830022334', email: 'orders@apexpaper.in', tax_id: '27EEEEE4444E1Z9', credit_limit_cents: 0, payment_terms_days: 45, opening_balance_cents: 450000 },
    { name: 'Reliance Poly Packaging', type: 'supplier', phone: '9830033445', email: 'poly@pack.in', tax_id: '27FFFFF5555F1Z0', credit_limit_cents: 0, payment_terms_days: 15, opening_balance_cents: 0 },
    { name: 'City Logistic & Courier Services', type: 'both', phone: '9840011223', email: 'info@citylogistics.in', tax_id: '27GGGGG6666G1Z1', credit_limit_cents: 5000000, payment_terms_days: 15, opening_balance_cents: 150000 },
    { name: 'Krishna Packaging & Agro', type: 'both', phone: '9840022334', email: 'contact@krishna.in', tax_id: '27HHHHH7777H1Z2', credit_limit_cents: 8000000, payment_terms_days: 30, opening_balance_cents: 0 },
  ];

  const createdParties = [];
  for (const pData of demoParties) {
    const existing = db.prepare('SELECT id FROM parties WHERE name = ?').get(pData.name);
    if (!existing) {
      const p = createParty(pData, ownerId, db);
      createdParties.push(p);
    } else {
      createdParties.push(existing);
    }
  }
  console.log(`Verified ${createdParties.length} Demo Parties.`);

  // Check existing transactions
  const txCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions').get().cnt;
  if (txCount < 30) {
    console.log('Generating 60 realistic transactions...');
    const usersList = [owner, staff1, staff2];

    const today = new Date();
    // Helper to format date offset from today
    function dateDaysAgo(daysAgo) {
      const d = new Date(today);
      d.setDate(d.getDate() - daysAgo);
      return d.toISOString().slice(0, 10);
    }

    let txCounter = 100;
    const recordedTxs = [];

    // Customer sales & collections
    const customers = createdParties.filter((p) => p.type === 'customer' || p.type === 'both');
    for (const cust of customers) {
      for (let day = 85; day >= 5; day -= 12) {
        txCounter++;
        const saleAmt = Math.round((Math.random() * 8000 + 2000) * 100); // ₹2,000 to ₹10,000
        const inv = createTransaction({
          party_id: cust.id,
          type: 'credit_sale',
          amount_cents: saleAmt,
          date: dateDaysAgo(day),
          reference_no: `INV-${txCounter}`,
          note: 'Goods dispatched via dispatch counter',
        }, usersList[day % 3], db);
        recordedTxs.push(inv);

        // Record a subsequent payment a few days later
        if (day > 15) {
          const payAmt = Math.round(saleAmt * (Math.random() > 0.4 ? 1.0 : 0.6));
          const pay = createTransaction({
            party_id: cust.id,
            type: 'payment_received',
            amount_cents: payAmt,
            date: dateDaysAgo(day - 6),
            reference_no: `UPI-${txCounter + 500}`,
            note: 'Payment received via UPI / Bank transfer',
            allocations: [{ invoice_id: inv.id, allocated_cents: payAmt }],
          }, usersList[(day + 1) % 3], db);
          recordedTxs.push(pay);
        }
      }
    }

    // Supplier purchases & payments
    const suppliers = createdParties.filter((p) => p.type === 'supplier' || p.type === 'both');
    for (const supp of suppliers) {
      for (let day = 75; day >= 10; day -= 18) {
        txCounter++;
        const purchAmt = Math.round((Math.random() * 15000 + 5000) * 100);
        const bill = createTransaction({
          party_id: supp.id,
          type: 'credit_purchase',
          amount_cents: purchAmt,
          date: dateDaysAgo(day),
          reference_no: `BILL-${txCounter}`,
          note: 'Stock replenishment bill received',
        }, owner, db);
        recordedTxs.push(bill);

        // Payment made
        const paidAmt = Math.round(purchAmt * 0.8);
        const pay = createTransaction({
          party_id: supp.id,
          type: 'payment_made',
          amount_cents: paidAmt,
          date: dateDaysAgo(day - 7),
          reference_no: `NEFT-${txCounter + 700}`,
          note: 'Vendor NEFT payment transfer',
        }, owner, db);
        recordedTxs.push(pay);
      }
    }

    // Add a couple of returns and discounts
    createTransaction({
      party_id: createdParties[0].id,
      type: 'sales_return',
      amount_cents: 150000, // ₹1,500.00
      date: dateDaysAgo(8),
      reference_no: 'RET-01',
      note: 'Defective packaging returned by customer',
    }, staff1, db);

    createTransaction({
      party_id: createdParties[1].id,
      type: 'discount',
      amount_cents: 50000, // ₹500.00
      date: dateDaysAgo(4),
      reference_no: 'DISC-01',
      note: 'Early settlement prompt payment discount',
    }, owner, db);

    // Create 1 realistic error & reversal
    const mistakenTx = createTransaction({
      party_id: createdParties[2].id,
      type: 'credit_sale',
      amount_cents: 220000, // ₹2,200.00
      date: dateDaysAgo(2),
      reference_no: 'ERR-999',
      note: 'Mistakenly punched twice at register',
    }, staff2, db);

    reverseTransaction(mistakenTx.id, 'Punched duplicate bill in error by staff', owner, db);

    console.log(`Generated total ${db.prepare('SELECT COUNT(*) as cnt FROM transactions').get().cnt} realistic transactions!`);
  }

  console.log('--- Seeding Complete! ---');
}

if (require.main === module) {
  runSeed();
}

module.exports = { runSeed };
