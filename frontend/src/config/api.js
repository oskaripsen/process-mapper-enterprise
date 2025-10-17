// API Configuration for Enterprise Edition
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

console.log('🔧 API_BASE_URL configured as:', API_BASE_URL);

/**
 * Get authentication token from localStorage
 * @returns {string|null} - The authentication token or null
 */
export const getAuthToken = () => {
  return localStorage.getItem('authToken');
};

/**
 * Set authentication token in localStorage
 * @param {string} token - The authentication token
 */
export const setAuthToken = (token) => {
  localStorage.setItem('authToken', token);
};

/**
 * Remove authentication token from localStorage
 */
export const clearAuthToken = () => {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
};

/**
 * Get current user from localStorage
 * @returns {Object|null} - The user object or null
 */
export const getCurrentUser = () => {
  const userStr = localStorage.getItem('user');
  return userStr ? JSON.parse(userStr) : null;
};

/**
 * Set current user in localStorage
 * @param {Object} user - The user object
 */
export const setCurrentUser = (user) => {
  localStorage.setItem('user', JSON.stringify(user));
};

/**
 * Make an authenticated API request
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Response>} - The fetch response
 */
export const authenticatedFetch = async (url, options = {}) => {
  try {
    const token = getAuthToken();
    
    if (!token) {
      throw new Error('No authentication token found');
    }
    
    // Merge headers with authentication
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };
    
    // If body is an object (not FormData), stringify it and set content-type
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    
    const response = await fetch(url, {
      ...options,
      headers,
    });
    
    // If unauthorized, clear token and redirect to login
    if (response.status === 401) {
      clearAuthToken();
      window.location.href = '/login';
    }
    
    return response;
  } catch (error) {
    console.error('Error in authenticated fetch:', error);
    throw error;
  }
};

/**
 * Check if user is authenticated
 * @returns {boolean} - True if user is authenticated
 */
export const isAuthenticated = () => {
  return !!getAuthToken();
};

export { API_BASE_URL };

