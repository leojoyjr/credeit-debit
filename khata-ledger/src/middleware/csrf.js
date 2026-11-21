/**
 * src/middleware/csrf.js
 * CSRF token protection for mutating HTTP requests.
 */

function verifyCsrf(req, res, next) {
  // Safe HTTP methods do not require CSRF token
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Exempt public endpoints like login and initial setup
  if (req.path === '/api/auth/login' || req.path === '/api/auth/setup') {
    return next();
  }

  if (!req.user) {
    return next(); // requireAuth will catch unauthenticated
  }

  const clientToken = req.headers['x-csrf-token'];
  if (!clientToken || clientToken !== req.user.csrfToken) {
    return res.status(403).json({
      error: 'INVALID_CSRF_TOKEN',
      message: 'Invalid or missing CSRF token. Please refresh the page and try again.',
    });
  }

  next();
}

module.exports = { verifyCsrf };
