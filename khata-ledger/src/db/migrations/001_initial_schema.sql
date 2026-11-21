-- Migration 001: Initial Schema
-- Sets up core tables with strict foreign keys and checks.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner', 'staff')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('customer', 'supplier', 'both')),
  phone TEXT,
  email TEXT,
  address TEXT,
  tax_id TEXT,
  credit_limit_cents INTEGER DEFAULT 0,
  payment_terms_days INTEGER DEFAULT 0,
  opening_balance_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  type TEXT NOT NULL CHECK(type IN (
    'credit_sale',
    'payment_received',
    'credit_purchase',
    'payment_made',
    'sales_return',
    'purchase_return',
    'discount',
    'write_off',
    'adjustment'
  )),
  date TEXT NOT NULL,
  due_date TEXT,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  reference_no TEXT,
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  reversed_of_id INTEGER REFERENCES transactions(id)
);

CREATE TABLE IF NOT EXISTS transaction_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_tx_id INTEGER NOT NULL REFERENCES transactions(id),
  invoice_tx_id INTEGER NOT NULL REFERENCES transactions(id),
  allocated_cents INTEGER NOT NULL CHECK(allocated_cents > 0),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  file_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes for lightning fast lookups & mobile response times
CREATE INDEX IF NOT EXISTS idx_parties_type_active ON parties(type, is_active);
CREATE INDEX IF NOT EXISTS idx_transactions_party_date ON transactions(party_id, date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_reversed ON transactions(reversed_of_id);
CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON transaction_allocations(invoice_tx_id);
CREATE INDEX IF NOT EXISTS idx_allocations_payment ON transaction_allocations(payment_tx_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
