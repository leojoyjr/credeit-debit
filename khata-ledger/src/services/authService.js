/**
 * src/services/authService.js
 * Authentication & session management using bcryptjs and secure crypto tokens.
 * Enforces first-run owner setup with strong password requirements.
 */

const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const config = require('../config');

// In-memory active session store: sessionToken -> { userId, role, name, username, expiresAt }
const sessions = new Map();

function hashPassword(plainPassword) {
  if (!plainPassword || plainPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  return bcrypt.hashSync(plainPassword, 10);
}

function verifyPassword(plainPassword, hash) {
  return bcrypt.compareSync(plainPassword, hash);
}

/**
 * Checks if the system needs initial owner setup (0 users exist).
 */
function needsSetup(db) {
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
  return count.count === 0;
}

/**
 * First-run owner account setup.
 * Fails if any user already exists.
 */
function setupOwner(data, db) {
  if (!needsSetup(db)) {
    throw new Error('Setup has already been completed. Owner account already exists.');
  }

  const name = (data.name || '').trim();
  const username = (data.username || '').trim().toLowerCase();
  const password = data.password || '';

  if (!name) throw new Error('Full name is required');
  if (!username || username.length < 3) throw new Error('Username must be at least 3 characters long');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters long');

  const passwordHash = hashPassword(password);

  const stmt = db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active)
    VALUES (?, ?, ?, 'owner', 1)
  `);
  const result = stmt.run(name, username, passwordHash);
  const userId = Number(result.lastInsertRowid);

  // Initialize default business profile in settings
  const settingsStmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  settingsStmt.run('business_name', data.business_name || config.businessName);
  settingsStmt.run('currency_code', config.currencyCode);
  settingsStmt.run('currency_symbol', config.currencySymbol);
  settingsStmt.run('tax_rate', String(config.defaultTaxRate));
  settingsStmt.run('date_format', 'YYYY-MM-DD');
  settingsStmt.run('reminder_template', 'Dear {party_name}, this is a gentle reminder that an amount of {amount} is pending on your account with {business_name}. Please clear it at your earliest convenience.');
  settingsStmt.run('invoice_prefix', 'INV-');

  // Log audit
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, after_json)
    VALUES (?, 'INITIAL_SETUP', 'users', ?, ?)
  `).run(userId, userId, JSON.stringify({ username, role: 'owner' }));

  return db.prepare('SELECT id, name, username, role, is_active, created_at FROM users WHERE id = ?').get(userId);
}

/**
 * Authenticate user credentials and issue session token.
 */
function login(username, password, db) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username.trim());
  if (!user || !user.is_active) {
    throw new Error('Invalid username or password');
  }

  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new Error('Invalid username or password');
  }

  // Generate crypto session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const csrfToken = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + config.sessionMaxAgeMs;

  sessions.set(sessionToken, {
    userId: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    csrfToken,
    expiresAt,
  });

  // Audit log
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, after_json)
    VALUES (?, 'LOGIN', 'users', ?, ?)
  `).run(user.id, user.id, JSON.stringify({ username: user.username }));

  return {
    sessionToken,
    csrfToken,
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    },
  };
}

/**
 * Verify session token and return user.
 */
function getSession(sessionToken) {
  if (!sessionToken) return null;
  const session = sessions.get(sessionToken);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionToken);
    return null;
  }

  return session;
}

/**
 * Invalidate session (logout).
 */
function logout(sessionToken) {
  if (sessionToken) {
    sessions.delete(sessionToken);
  }
}

/**
 * Create a new user (Staff or additional Owner). Only by Owner.
 */
function createUser(data, currentUser, db) {
  if (!currentUser || currentUser.role !== 'owner') {
    const err = new Error('Permission denied: Only Owner can create users');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const name = (data.name || '').trim();
  const username = (data.username || '').trim().toLowerCase();
  const password = data.password || '';
  const role = data.role === 'owner' ? 'owner' : 'staff';

  if (!name) throw new Error('Name is required');
  if (!username || username.length < 3) throw new Error('Username must be at least 3 characters');
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters');

  // Check unique username
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) throw new Error('Username is already taken');

  const passwordHash = hashPassword(password);
  const stmt = db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active)
    VALUES (?, ?, ?, ?, 1)
  `);
  const result = stmt.run(name, username, passwordHash, role);
  const newUserId = Number(result.lastInsertRowid);

  // Audit log
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, after_json)
    VALUES (?, 'CREATE_USER', 'users', ?, ?)
  `).run(currentUser.id, newUserId, JSON.stringify({ id: newUserId, username, role }));

  return db.prepare('SELECT id, name, username, role, is_active, created_at FROM users WHERE id = ?').get(newUserId);
}

/**
 * List all users (Owner only).
 */
function listUsers(currentUser, db) {
  if (!currentUser || currentUser.role !== 'owner') {
    const err = new Error('Permission denied: Only Owner can list users');
    err.code = 'FORBIDDEN';
    throw err;
  }
  return db.prepare('SELECT id, name, username, role, is_active, created_at FROM users ORDER BY id ASC').all();
}

/**
 * Deactivate user.
 */
function deactivateUser(userId, currentUser, db) {
  if (!currentUser || currentUser.role !== 'owner') {
    const err = new Error('Permission denied: Only Owner can deactivate users');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (userId === currentUser.id) {
    throw new Error('You cannot deactivate your own account');
  }

  db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id)
    VALUES (?, 'DEACTIVATE_USER', 'users', ?)
  `).run(currentUser.id, userId);

  return { success: true };
}

module.exports = {
  hashPassword,
  verifyPassword,
  needsSetup,
  setupOwner,
  login,
  getSession,
  logout,
  createUser,
  listUsers,
  deactivateUser,
  sessions,
};
