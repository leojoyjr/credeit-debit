/**
 * public/js/api.js
 * Clean, lightweight fetch wrapper handling CSRF tokens, sessions, and consistent error handling.
 */

const api = {
  csrfToken: null,

  setCsrfToken(token) {
    this.csrfToken = token;
  },

  async request(url, options = {}) {
    const headers = { ...options.headers };

    // Attach CSRF token on mutating HTTP requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes((options.method || 'GET').toUpperCase())) {
      if (this.csrfToken) {
        headers['x-csrf-token'] = this.csrfToken;
      }
    }

    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, { ...options, headers });

    // Handle 401 Unauthorized (session expired or logged out)
    if (response.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/setup-status')) {
      window.dispatchEvent(new CustomEvent('auth:required'));
      throw new Error('Please log in to continue.');
    }

    // Check if JSON response
    const contentType = response.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const error = new Error(data.message || (typeof data === 'string' ? data : 'Request failed'));
      error.code = data.error || 'SERVER_ERROR';
      error.details = data;
      error.status = response.status;
      throw error;
    }

    return data;
  },

  get(url, options) {
    return this.request(url, { ...options, method: 'GET' });
  },

  post(url, body, options) {
    return this.request(url, { ...options, method: 'POST', body });
  },

  put(url, body, options) {
    return this.request(url, { ...options, method: 'PUT', body });
  },

  delete(url, options) {
    return this.request(url, { ...options, method: 'DELETE' });
  },
};
