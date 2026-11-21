/**
 * src/routes/authRoutes.js
 * Endpoints for setup, login, logout, current user, and user management.
 */

const express = require('express');
const router = express.Router();
const config = require('../config');
const { getDb } = require('../db');
const {
  needsSetup,
  setupOwner,
  login,
  logout,
  createUser,
  listUsers,
  deactivateUser,
} = require('../services/authService');
const { requireAuth, requireOwner } = require('../middleware/auth');
const { loginRateLimiter, recordLoginSuccess } = require('../middleware/rateLimiter');

// Check if first-run setup is required
router.get('/setup-status', (req, res) => {
  const db = getDb();
  res.json({ needs_setup: needsSetup(db) });
});

// First-time owner setup
router.post('/setup', (req, res, next) => {
  try {
    const db = getDb();
    const owner = setupOwner(req.body, db);
    res.status(201).json({ message: 'Owner account successfully created!', user: owner });
  } catch (err) {
    next(err);
  }
});

// Login with rate limiting
router.post('/login', loginRateLimiter, (req, res, next) => {
  try {
    const { username, password } = req.body;
    const db = getDb();
    const result = login(username, password, db);

    recordLoginSuccess(req);

    // Set secure HTTP-only cookie
    res.cookie(config.sessionCookieName, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: config.sessionMaxAgeMs,
      path: '/',
    });

    res.json({
      message: 'Login successful',
      user: result.user,
      csrf_token: result.csrfToken,
    });
  } catch (err) {
    next(err);
  }
});

// Logout
router.post('/logout', (req, res) => {
  const sessionToken = req.cookies && req.cookies[config.sessionCookieName];
  if (sessionToken) {
    logout(sessionToken);
  }
  res.clearCookie(config.sessionCookieName, { path: '/' });
  res.json({ message: 'Logged out successfully' });
});

// Current user profile & CSRF token
router.get('/me', requireAuth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      username: req.user.username,
      role: req.user.role,
    },
    csrf_token: req.user.csrfToken,
  });
});

// User management (Owner only)
router.get('/users', requireAuth, requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const users = listUsers(req.user, db);
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAuth, requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const newUser = createUser(req.body, req.user, db);
    res.status(201).json(newUser);
  } catch (err) {
    next(err);
  }
});

router.post('/users/:id/deactivate', requireAuth, requireOwner, (req, res, next) => {
  try {
    const db = getDb();
    const result = deactivateUser(parseInt(req.params.id, 10), req.user, db);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
