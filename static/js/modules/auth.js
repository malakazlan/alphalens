// Auth Module
// Handles authentication, token management, and user session

// Ensure API_BASE_URL is available
if (typeof API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// Store current user and token
let currentUser = null;
let accessToken = null;

// Get auth token from localStorage or cookie
function getAuthToken() {
    // Try localStorage first
    const token = localStorage.getItem('access_token');
    if (token) {
        accessToken = token;
        return token;
    }
    return null;
}

// Get auth headers for API calls
function getAuthHeaders() {
    const token = getAuthToken();
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

// Check authentication on page load
async function checkAuthentication() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/auth/session`, {
            credentials: 'include',
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            currentUser = data.user;
            accessToken = getAuthToken();
            // Show user info
            updateUserDisplay();
            return true;
        } else {
            // Not authenticated, redirect to login
            window.location.href = '/login';
            return false;
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login';
        return false;
    }
}

// Update user display
function updateUserDisplay() {
    if (currentUser) {
        // Add user email to header if needed
        const userInfo = document.getElementById('user-info');
        if (userInfo) {
            userInfo.textContent = currentUser.email;
        }
    }
}

// Logout function
async function logout() {
    try {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
            method: 'POST',
            credentials: 'include',
            headers: getAuthHeaders()
        });
        
        // Clear local storage
        localStorage.removeItem('access_token');
        accessToken = null;
        currentUser = null;
        
        // Redirect to login
        window.location.href = '/login';
    } catch (error) {
        console.error('Logout error:', error);
        // Still redirect even if logout fails
        localStorage.removeItem('access_token');
        window.location.href = '/login';
    }
}

// Export functions
window.getAuthToken = getAuthToken;
window.getAuthHeaders = getAuthHeaders;
window.checkAuthentication = checkAuthentication;
window.updateUserDisplay = updateUserDisplay;
window.logout = logout;

// Export for module access
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        getAuthToken,
        getAuthHeaders,
        checkAuthentication,
        updateUserDisplay,
        logout,
        get currentUser() { return currentUser; },
        get accessToken() { return accessToken; }
    };
}

