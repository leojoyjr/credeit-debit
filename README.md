# Khata Ledger (खाता लेजर)
> A modern, digital account book built specifically for small businesses managing customer credit (debtors), supplier credit (creditors), invoice tracking, and fast shop-counter entry.

---

## 🌟 Key Features
- **Mobile-First & 3-Tap Fast Entry:** Designed to be tapped effortlessly at a physical store counter or on mobile phones.
- **Accurate Money Math:** All amounts are stored strictly as integer cents (or paise for INR) so floating-point rounding errors never happen.
- **Dynamic Balance Calculation:** Balances are **always calculated dynamically** from opening balance + transactions. Never stored or silently edited.
- **Accounting Immutability:** Transactions are **never deleted or modified in place**. Erroneous entries are reversed via linked reversal entries (`reversed_of_id`) and displayed with clear strike-throughs in the ledger statement.
- **Credit Limit & Terms Enforcement:** Warns staff when a credit sale would push a customer over their limit, with owner override authorization.
- **Invoice Tracking & Allocations:** Track invoices as `open`, `partly_paid`, `paid`, or `overdue`, with optional allocation of payments to specific bills.
- **Printable Statements & PDF Download:** Crisp PDF statement generator with business name, tax ID, running balances, and totals.
- **Payment Reminders:** Instant, ready-to-send WhatsApp (`wa.me`) and email links using customizable message templates (no auto-spamming).
- **Security & RBAC:** Role-based access control (Owner vs. Staff), bcrypt password hashing, HTTP-only session cookies, CSRF protection, login rate limiting, and an immutable audit log.
- **Data Safety:** Built on SQLite in WAL mode with foreign keys enabled, automatic daily backups retaining the last 30, and on-demand "Backup Now" functionality.

---

## 🚀 Quick Start (Development)

### Prerequisites
- **Node.js 22.0.0 or higher** (uses built-in `node:sqlite` and `node:test`).

### 1. Installation
```bash
git clone <repo-url>
cd khata-ledger
npm install
```

### 2. Run the App
```bash
npm start
```
Open **http://localhost:3000** in your browser.

### 3. First-Run Owner Setup
On your first visit, Khata Ledger detects that no users exist and will present the **First-Run Setup Screen**.
- Enter your **Business Name** (e.g., Sharma Hardware).
- Enter your **Full Name** and **Username**.
- Choose a strong password (at least 8 characters).
- Once submitted, your master Owner account is initialized!

### 4. Optional: Load Realistic Demo Data
To try out the application with 10 parties and 60 realistic transactions across the last 90 days:
```bash
npm run seed
```
Demo Logins created by the seed script:
- **Owner Account:** Username: `admin` | Password: `Admin@12345`
- **Staff Account 1:** Username: `staff1` | Password: `Staff@12345`
- **Staff Account 2:** Username: `staff2` | Password: `Staff@12345`

---

## 🧪 Running Automated Tests
The project includes a comprehensive test suite covering money math, balance sign conventions, reversal logic, credit limit enforcement, invoice allocation, and security/roles:
```bash
npm test
```

---

## 🐳 Running with Docker
You can also run Khata Ledger in an isolated container with persistent volumes:
```bash
# Build and run with docker-compose
docker-compose up -d --build
```
Your database and backups will persist in the local `./data` and `./backups` directories.

---

## 💾 Backup and Restore Procedure

### Automatic Backups
Khata Ledger runs an automated backup timer every 24 hours. Backups are stored in `backups/khata_backup_<timestamp>.db`. The system automatically keeps the last 30 backups and prunes older ones.

### Manual On-Demand Backup
1. Log in as **Owner**.
2. Go to **Settings** $\to$ **Database Backups & Safety**.
3. Tap **"💾 Backup Now"**. The backup is created instantly via SQLite's native `VACUUM INTO` command (which guarantees a clean, transactional copy without locking live writers).
4. Tap **Download** to save the `.db` file to your computer.

### Restore Procedure
To restore your database from a backup file:
```bash
# 1. Stop the application server
# 2. Check the integrity of your backup file:
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('backups/khata_backup_YYYY-MM-DD.db'); console.log(db.prepare('PRAGMA integrity_check').get());"

# 3. Replace data/khata.db with your backup:
cp backups/khata_backup_YYYY-MM-DD.db data/khata.db

# 4. Remove any stale WAL journal files:
rm -f data/khata.db-wal data/khata.db-shm

# 5. Start the server:
npm start
```

---

## 🌐 Deploying on a Small Linux VPS (e.g. $5/mo Ubuntu)

Here is a simple, battle-tested deployment setup using **Node.js**, **PM2** (process manager), and **Caddy** (automatic HTTPS reverse proxy).

### 1. Install Node.js 22 on Ubuntu
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Clone and Setup Khata Ledger
```bash
git clone <repo-url> /var/www/khata-ledger
cd /var/www/khata-ledger
npm install --omit=dev
cp .env.example .env
nano .env # Set your own secure SESSION_SECRET
```

### 3. Run with PM2 (Auto-restart on reboot)
```bash
sudo npm install -g pm2
pm2 start src/server.js --name "khata-ledger"
pm2 startup
pm2 save
```

### 4. Expose with Caddy (Automatic Free SSL / HTTPS)
Install Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```
Edit `/etc/caddy/Caddyfile`:
```caddy
yourdomain.com {
    reverse_proxy localhost:3000
}
```
Reload Caddy:
```bash
sudo systemctl reload caddy
```
Your app is now securely accessible over HTTPS with automatic certificate renewal!

---

## 📚 How It Works (A Beginner's Guide)

### 1. Folder Structure
```text
khata-ledger/
├── src/
│   ├── server.js            # Express app setup, security headers, routing bootstrap
│   ├── config.js            # Environment settings and defaults
│   ├── db/
│   │   ├── index.js         # SQLite connection using Node 22 node:sqlite (WAL mode)
│   │   ├── migrator.js      # Automatic database schema migrator
│   │   └── migrations/      # 001_initial_schema.sql (table structures & indexes)
│   ├── middleware/          # Security checks: auth.js, csrf.js, rateLimiter.js
│   ├── services/            # Pure business logic (money math, reversals, PDF generator)
│   └── routes/              # Express API endpoints that call services
├── public/                  # Frontend: plain HTML, CSS, and Vanilla JavaScript
└── tests/                   # Automated unit & security tests with node:test
```

### 2. How a Request Travels
When a shop staff member records a transaction on their phone:
1. **Browser (`public/js/app.js`):** Collects form data, includes the `x-csrf-token` header, and sends `POST /api/transactions`.
2. **Security Middleware (`src/middleware/auth.js` & `csrf.js`):** Verifies the HTTP-only cookie, checks user permissions, and ensures the CSRF token matches the session.
3. **Route Handler (`src/routes/transactionRoutes.js`):** Receives the request and forwards it to `transactionService.createTransaction()`.
4. **Business Service (`src/services/transactionService.js`):**
   - Validates party status and converts currency to integer cents.
   - Checks if customer credit limit is exceeded.
   - Computes due date from payment terms.
   - Inserts transaction into SQLite.
   - Writes an immutable record to `audit_log`.
5. **Database (`src/db/index.js`):** Executes parameterized SQL statement against `khata.db` in WAL mode.
6. **Response:** Returns the newly created transaction to the browser, updating the running balance.

### 3. How to Add a New Transaction Type
If you want to add a new transaction type (for example, `incentive_bonus`):
1. **Database Schema:** In `src/db/migrations/001_initial_schema.sql` (or a new migration `002_add_type.sql`), update the `CHECK(type IN (...))` constraint.
2. **Transaction Service:** In `src/services/transactionService.js`, add `'incentive_bonus'` to `VALID_TYPES`.
3. **Party Service Math:** In `src/services/partyService.js`, specify whether it adds or subtracts from the customer or supplier ledger in `getTransactionCustomerDelta()` and `getTransactionSupplierDelta()`.
4. **Frontend UI:** In `public/index.html`, add a `<button class="type-btn" data-tx-type="incentive_bonus">Incentive Bonus</button>` in the type selector grid.

---

## 🗺️ Roadmap
- Multi-currency conversion for cross-border trade.
- SMS / WhatsApp gateway integration for optional automated dispatch.
- Multi-branch support with separate counter registers.
- Barcode scanner integration for itemized billing.

---

## 📋 Self-Verification Checklist & Known Limitations

### Self-Verification Checklist
1. **Clean Installation:** Run `npm install && npm start`. The server boots on port 3000.
2. **First-Run Guard:** Visiting the app when no users exist opens the setup wizard; subsequent visits require login.
3. **Balance Math:**
   - Add a Customer with opening balance ₹100.00.
   - Record a Credit Sale of ₹50.00 $\to$ Balance displays ₹150.00 (Customer owes you).
   - Record a Payment of ₹200.00 $\to$ Balance displays -₹50.00 (Advance Received).
4. **Reversal Auditability:**
   - Log in as Owner $\to$ Open party statement $\to$ Click "Reverse" on any entry.
   - Transaction is **never deleted**; an opposite reversal entry is linked, original entry is struck through, and balance is restored.
5. **Role Restrictions:**
   - Log in as Staff $\to$ Try to access Settings, reverse a transaction, or export CSV $\to$ Action is blocked and forbidden.
6. **Backup Test:**
   - In Settings, click "Backup Now". Download the `.db` file and verify it opens cleanly.

### Known Limitations
- Single-store / single-ledger architecture (not multi-tenant without running separate container instances).
- Attachments are stored on local disk (under `uploads/`); for distributed multi-server setups, an S3-compatible object store would be required.
