/**
 * src/server.js
 * Main entry point for the Khata Ledger web application.
 */

const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const cookieParser = require('cookie-parser');

const config = require('./config');
const { getDb } = require('./db');
const { runMigrations } = require('./db/migrator');
const { createBackup } = require('./services/backupService');
const { verifyCsrf } = require('./middleware/csrf');
const errorHandler = require('./middleware/errorHandler');

// Route modules
const authRoutes = require('./routes/authRoutes');
const partyRoutes = require('./routes/partyRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const reportRoutes = require('./routes/reportRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const backupRoutes = require('./routes/backupRoutes');

// Ensure necessary directories exist
[config.uploadDir, config.backupDir, path.dirname(config.dbPath)].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Run database schema migrations
const db = getDb();
runMigrations(db);

const app = express();

// Security Headers (equivalent to Helmet with zero extra dependencies)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'"
  );
  next();
});

// Parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser(config.sessionSecret));

// CSRF token verification middleware
app.use(verifyCsrf);

// Serve frontend static assets
app.use(express.static(path.resolve(__dirname, '..', 'public')));
// Serve bill / receipt uploads safely
app.use('/uploads', express.static(config.uploadDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/ledger', ledgerRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/backup', backupRoutes);

// Fallback for Single Page App navigation
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return next();
  }
  res.sendFile(path.resolve(__dirname, '..', 'public', 'index.html'));
});

// Error handling middleware
app.use(errorHandler);

// Daily automated backup schedule (every 24 hours)
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
setInterval(() => {
  try {
    const backup = createBackup(db);
    console.log(`[Backup] Automated daily backup created: ${backup.filename}`);
  } catch (err) {
    console.error('[Backup] Automated backup failed:', err);
  }
}, ONE_DAY_MS);

// Start server
if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`===============================================`);
    console.log(` Khata Ledger is running!`);
    console.log(` Local URL: http://localhost:${config.port}`);
    console.log(` Environment: ${config.nodeEnv}`);
    console.log(` Database: SQLite (WAL mode enabled)`);
    console.log(`===============================================`);
  });
}

module.exports = app;
