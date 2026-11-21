/**
 * src/config.js
 * Central configuration module. Reads from environment variables with sensible defaults.
 */
const path = require('node:path');
const fs = require('node:fs');

// Simple zero-dependency .env parser
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'khata.db'),
  sessionSecret: process.env.SESSION_SECRET || 'khata_default_insecure_secret_must_change',
  businessName: process.env.BUSINESS_NAME || 'Khata Ledger',
  currencyCode: process.env.CURRENCY_CODE || 'INR',
  currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
  defaultTaxRate: parseFloat(process.env.DEFAULT_TAX_RATE) || 18,
  sessionCookieName: 'khata_sid',
  sessionMaxAgeMs: 12 * 60 * 60 * 1000, // 12 hours
  uploadDir: path.resolve(__dirname, '..', 'uploads'),
  backupDir: path.resolve(__dirname, '..', 'backups'),
};
