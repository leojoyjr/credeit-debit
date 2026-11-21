/**
 * src/middleware/rateLimiter.js
 * Simple in-memory rate limiter to protect against brute-force attacks on login.
 */

const loginAttempts = new Map(); // ip_username -> { count, firstAttemptTime }
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const username = (req.body && req.body.username ? req.body.username.trim().toLowerCase() : '');
  const key = `${ip}_${username}`;

  const now = Date.now();
  const record = loginAttempts.get(key);

  if (record) {
    if (now - record.firstAttemptTime > WINDOW_MS) {
      // Window expired, reset
      loginAttempts.set(key, { count: 1, firstAttemptTime: now });
      return next();
    }

    if (record.count >= MAX_ATTEMPTS) {
      const remainingSec = Math.ceil((record.firstAttemptTime + WINDOW_MS - now) / 1000);
      return res.status(429).json({
        error: 'TOO_MANY_REQUESTS',
        message: `Too many failed login attempts. Please try again in ${remainingSec} seconds.`,
      });
    }

    record.count += 1;
  } else {
    loginAttempts.set(key, { count: 1, firstAttemptTime: now });
  }

  next();
}

function recordLoginSuccess(req) {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const username = (req.body && req.body.username ? req.body.username.trim().toLowerCase() : '');
  const key = `${ip}_${username}`;
  loginAttempts.delete(key);
}

module.exports = {
  loginRateLimiter,
  recordLoginSuccess,
  loginAttempts,
};
