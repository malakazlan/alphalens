// Utils Module
// Helper functions for formatting, escaping, and common utilities

// Escape HTML to prevent XSS
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Format values (currency, numbers)
function formatValue(value, unit) {
    if (typeof value === 'number') {
        // Format currency
        if (unit === 'USD') {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD'
            }).format(value);
        }
        
        // Format other numbers
        return new Intl.NumberFormat('en-US').format(value);
    }
    
    return value;
}

// Format bounding box coordinates
function formatBoundingBox(box) {
    if (!box) return '';
    if (typeof box.left === 'number' && typeof box.top === 'number' &&
        typeof box.right === 'number' && typeof box.bottom === 'number') {
        const pct = value => `${(value * 100).toFixed(1)}%`;
        return `${pct(box.left)}, ${pct(box.top)} → ${pct(box.right)}, ${pct(box.bottom)}`;
    }
    return '';
}

// Export functions
window.escapeHtml = escapeHtml;
window.formatValue = formatValue;
window.formatBoundingBox = formatBoundingBox;

