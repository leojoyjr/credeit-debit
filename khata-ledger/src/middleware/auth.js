/**
 * src/middleware/auth.js
 * Session verification and role-based access control.
 */

const { getSession } = require('../services/authService');
const config = require('../config');

function requireAuth(req, res, next) {
  const sessionToken = req.cookies && req.cookies[config.sessionCookieName];
  if (!sessionToken) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' });
  }

  const session = getSession(sessionToken);
  if (!session) {
    res.clearCookie(config.sessionCookieName);
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Session expired or invalid. Please log in again.' });
  }

  req.user = {
    id: session.userId,
    name: session.name,
    username: session.username,
    role: session.role,
    csrfToken: session.csrfToken,
    sessionToken,
  };

  next();
}

function requireOwner(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
  }
  if (req.user.role !== 'owner') {
    return res.status(403).json({ error: 'FORBIDDEN', message: 'Permission denied: This action is restricted to the business Owner.' });
  }
  next();
}

module.exports = {
  requireAuth,
  requireOwner,
};
