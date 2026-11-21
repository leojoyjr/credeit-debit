/**
 * src/middleware/errorHandler.js
 * Centralized error handling middleware.
 * Ensures consistent, clean JSON error responses across the entire application.
 */

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || (err.code === 'FORBIDDEN' ? 403 : err.code === 'UNAUTHORIZED' ? 401 : err.code === 'CREDIT_LIMIT_EXCEEDED' ? 400 : 400);

  const response = {
    error: err.code || 'BAD_REQUEST',
    message: err.message || 'An unexpected error occurred',
  };

  if (err.code === 'CREDIT_LIMIT_EXCEEDED') {
    response.current_balance_cents = err.current_balance_cents;
    response.limit_cents = err.limit_cents;
    response.projected_balance_cents = err.projected_balance_cents;
    response.can_override = err.can_override || false;
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;
