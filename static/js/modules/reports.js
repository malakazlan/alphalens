// Reports Module
// Handles report generation, formatting, and display

// Ensure API_BASE_URL is available (fallback if main.js hasn't loaded)
if (typeof API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// Helper to get auth headers safely
function getAuthHeadersSafe() {
    if (typeof getAuthHeaders === 'function') {
        return getAuthHeaders();
    }
    // Fallback
    const token = localStorage.getItem('access_token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

/**
 * Generate a professional markdown report from document data
 * This now calls the backend API to generate a professional financial analysis report
 * @param {Object} docData - Document data object
 * @returns {Promise<string>} Formatted markdown report
 */
async function generateReportMarkdown(docData) {
    if (!docData || !docData.document_id) return '';
    
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const headers = getAuthHeadersSafe();
        
        // Call the professional report generation endpoint
        const response = await fetch(`${apiBase}/documents/${docData.document_id}/report`, {
            credentials: 'include',
            headers: headers
        });
        
        if (!response.ok) {
            throw new Error(`Failed to generate report: ${response.statusText}`);
        }
        
        const reportData = await response.json();
        return reportData.report || '';
    } catch (error) {
        console.error('Error generating professional report:', error);
        // Fallback to basic report if API fails
        return generateBasicReportMarkdown(docData);
    }
}

/**
 * Generate a basic markdown report (fallback)
 * @param {Object} docData - Document data object
 * @returns {string} Formatted markdown report
 */
function generateBasicReportMarkdown(docData) {
    if (!docData) return '';
    
    const filename = docData.filename || 'Unknown Document';
    const uploadDate = docData.upload_time || 'Unknown';
    const status = docData.status || 'unknown';
    const pages = docData.metadata?.pages || docData.metadata?.page_count || 'N/A';
    
    let report = `# Document Report: ${filename}\n\n`;
    
    // Document Information Section
    report += `## Document Information\n\n`;
    report += `- **File Name**: ${filename}\n`;
    report += `- **Upload Date**: ${uploadDate}\n`;
    report += `- **Status**: ${status}\n`;
    report += `- **Pages**: ${pages}\n\n`;
    
    // Executive Summary
    if (docData.summary) {
        report += `## Executive Summary\n\n`;
        report += `${docData.summary}\n\n`;
    }
    
    // Key Metrics
    if (docData.key_metrics && docData.key_metrics.length > 0) {
        report += `## Key Metrics\n\n`;
        docData.key_metrics.forEach(metric => {
            const value = metric.value || 'N/A';
            const unit = metric.unit ? ` ${metric.unit}` : '';
            report += `- **${metric.name}**: ${value}${unit}\n`;
        });
        report += `\n`;
    }
    
    return report;
}

/**
 * Convert table data array to markdown table format
 * @param {Array} tableData - Array of table rows
 * @returns {string} Markdown formatted table
 */
function convertTableToMarkdown(tableData) {
    if (!tableData || tableData.length === 0) return '';
    
    // Assume first row is header
    const header = tableData[0];
    const rows = tableData.slice(1);
    
    let markdown = '| ' + header.join(' | ') + ' |\n';
    markdown += '| ' + header.map(() => '---').join(' | ') + ' |\n';
    
    rows.forEach(row => {
        markdown += '| ' + row.join(' | ') + ' |\n';
    });
    
    return markdown;
}

/**
 * Load and render all reports
 */
async function loadReports() {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const headers = getAuthHeadersSafe();
        
        const response = await fetch(`${apiBase}/documents`, {
            credentials: 'include',
            headers: headers
        });
        
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to load documents');
        }
        
        const documents = await response.json();
        renderReports(documents);
    } catch (error) {
        console.error('Error loading reports:', error);
        const reportsSection = document.getElementById('reports-section');
        if (reportsSection) {
            reportsSection.innerHTML = `
                <div class="glass-card" style="text-align: center; padding: 80px 40px;">
                    <h2 style="font-size: 2.5rem; color: var(--text); margin-bottom: 16px;">Reports</h2>
                    <p style="font-size: 1.2rem; color: var(--text-secondary); margin-bottom: 32px;">Error loading reports</p>
                    <p style="color: var(--text-secondary); max-width: 600px; margin: 0 auto;">
                        ${error.message || 'Please try again later.'}
                    </p>
                </div>
            `;
        }
    }
}

/**
 * Helper function to deduplicate documents by filename (keep most recent)
 * @param {Array} documents - Array of document objects
 * @returns {Array} Deduplicated array
 */
function deduplicateDocuments(documents) {
    if (!documents || documents.length === 0) return [];
    
    // Create a map to store the most recent document for each filename
    const uniqueDocs = new Map();
    
    documents.forEach(doc => {
        const filename = doc.filename || doc.document_id;
        const existingDoc = uniqueDocs.get(filename);
        
        // If no existing doc for this filename, or this one is newer, use this one
        if (!existingDoc) {
            uniqueDocs.set(filename, doc);
        } else {
            // Compare upload times to keep the most recent
            const existingTime = existingDoc.upload_time || existingDoc.document_id;
            const currentTime = doc.upload_time || doc.document_id;
            
            // If current doc is newer (or same but prefer current), replace
            if (currentTime >= existingTime) {
                uniqueDocs.set(filename, doc);
            }
        }
    });
    
    // Convert map to array and sort by upload time (newest first)
    const result = Array.from(uniqueDocs.values());
    result.sort((a, b) => {
        const timeA = a.upload_time || a.document_id;
        const timeB = b.upload_time || b.document_id;
        return timeB.localeCompare(timeA); // Descending order (newest first)
    });
    
    return result;
}

/**
 * Render report in the reports section
 * @param {Array} documents - Array of document objects
 */
function renderReports(documents) {
    const reportsSection = document.getElementById('reports-section');
    if (!reportsSection) return;
    
    // Filter only completed documents
    const completedDocs = documents.filter(doc => doc.status === 'complete');
    
    // Deduplicate by filename (keep most recent)
    const uniqueCompletedDocs = deduplicateDocuments(completedDocs);
    
    if (uniqueCompletedDocs.length === 0) {
        reportsSection.innerHTML = `
            <div class="glass-card" style="text-align: center; padding: 80px 40px;">
                <h2 style="font-size: 2.5rem; color: var(--text); margin-bottom: 16px;">Reports</h2>
                <p style="font-size: 1.2rem; color: var(--text-secondary); margin-bottom: 32px;">No reports available yet</p>
                <p style="color: var(--text-secondary); max-width: 600px; margin: 0 auto;">
                    Upload and process documents in the Analyzer section to generate reports.
                </p>
            </div>
        `;
        return;
    }
    
    // Build reports grid
    let html = `
        <div class="reports-container">
            <div class="reports-header">
                <h2 class="reports-title">Document Reports</h2>
                <div class="reports-actions">
                    <input type="text" id="reports-search" placeholder="Search reports..." class="reports-search">
                </div>
            </div>
            <div class="reports-grid" id="reports-grid">
    `;
    
    uniqueCompletedDocs.forEach(doc => {
        const preview = `Professional Financial Analysis Report for ${doc.filename || doc.document_id}`;
        
        html += `
            <div class="report-card" data-document-id="${doc.document_id}">
                <div class="report-card-header">
                    <h3 class="report-card-title">${doc.filename || doc.document_id}</h3>
                    <span class="status-chip ${doc.status}">${doc.status}</span>
                </div>
                <div class="report-card-content">
                    <p class="report-card-meta">Uploaded: ${doc.upload_time || 'Unknown'}</p>
                    <div class="report-card-preview">
                        ${escapeHtml(preview)}
                    </div>
                </div>
                <div class="report-card-actions">
                    <button class="report-view-btn" onclick="viewReport('${doc.document_id}')">View Report</button>
                    <button class="report-export-btn" onclick="exportReport('${doc.document_id}', 'markdown')">Export MD</button>
                    <button class="report-export-btn" onclick="exportReport('${doc.document_id}', 'json')">Export JSON</button>
                </div>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
        
        <!-- Report Viewer Modal -->
        <div id="report-viewer-modal" class="report-modal" style="display: none;">
            <div class="report-modal-content">
                <div class="report-modal-header">
                    <h2 id="report-modal-title">Report Viewer</h2>
                    <button class="report-modal-close" onclick="closeReportViewer()">×</button>
                </div>
                <div class="report-modal-body" id="report-modal-body">
                    <!-- Report content will be loaded here -->
                </div>
                <div class="report-modal-footer">
                    <button class="report-export-btn" onclick="exportCurrentReport('markdown')">Export Markdown</button>
                    <button class="report-export-btn" onclick="exportCurrentReport('json')">Export JSON</button>
                    <button class="report-export-btn" onclick="exportCurrentReport('pdf')">Export PDF</button>
                </div>
            </div>
        </div>
    `;
    
    reportsSection.innerHTML = html;
    
    // Add search functionality
    const searchInput = document.getElementById('reports-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterReports(e.target.value);
        });
    }
}

/**
 * View a specific report
 * @param {string} documentId - Document ID
 */
async function viewReport(documentId) {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const headers = getAuthHeadersSafe();
        
        // Show loading state
        const modal = document.getElementById('report-viewer-modal');
        const modalTitle = document.getElementById('report-modal-title');
        const modalBody = document.getElementById('report-modal-body');
        
        if (modal && modalTitle && modalBody) {
            modalTitle.textContent = 'Generating Report...';
            modalBody.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div><p>Generating professional financial analysis report...</p></div>';
            modal.style.display = 'flex';
        }
        
        // Get document data
        const docResponse = await fetch(`${apiBase}/documents/${documentId}`, {
            credentials: 'include',
            headers: headers
        });
        
        if (!docResponse.ok) throw new Error('Failed to load document');
        
        const docData = await docResponse.json();
        
        // Generate professional report
        const reportMarkdown = await generateReportMarkdown(docData);
        
        if (modal && modalTitle && modalBody) {
            modalTitle.textContent = `Financial Analysis Report: ${docData.filename || documentId}`;
            
            // Convert markdown to HTML with professional styling
            const htmlContent = convertMarkdownToHTML(reportMarkdown);
            modalBody.innerHTML = htmlContent;
            
            // Store current document for export
            modal.dataset.documentId = documentId;
            modal.dataset.documentData = JSON.stringify(docData);
            modal.dataset.reportMarkdown = reportMarkdown;
        }
    } catch (error) {
        console.error('Error viewing report:', error);
        const modalBody = document.getElementById('report-modal-body');
        if (modalBody) {
            modalBody.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--error);"><p>Failed to load report: ${error.message}</p><p>Please try again.</p></div>`;
        }
    }
}

/**
 * Close report viewer modal
 */
function closeReportViewer() {
    const modal = document.getElementById('report-viewer-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Export report in specified format
 * @param {string} documentId - Document ID
 * @param {string} format - Export format (markdown, json, pdf)
 */
async function exportReport(documentId, format) {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const headers = getAuthHeadersSafe();
        
        const response = await fetch(`${apiBase}/documents/${documentId}`, {
            credentials: 'include',
            headers: headers
        });
        
        if (!response.ok) throw new Error('Failed to load document');
        
        const docData = await response.json();
        
        if (format === 'markdown') {
            const markdown = await generateReportMarkdown(docData);
            downloadFile(markdown, `${docData.filename || documentId}_Financial_Report.md`, 'text/markdown');
        } else if (format === 'json') {
            const json = JSON.stringify(docData, null, 2);
            downloadFile(json, `${docData.filename || documentId}.json`, 'application/json');
        } else if (format === 'pdf') {
            // PDF export will be implemented later
            alert('PDF export coming soon!');
        }
    } catch (error) {
        console.error('Error exporting report:', error);
        alert('Failed to export report. Please try again.');
    }
}

/**
 * Export current report from modal
 * @param {string} format - Export format
 */
async function exportCurrentReport(format) {
    const modal = document.getElementById('report-viewer-modal');
    if (!modal) return;
    
    const documentId = modal.dataset.documentId;
    const reportMarkdown = modal.dataset.reportMarkdown;
    
    if (format === 'markdown' && reportMarkdown) {
        // Use cached report if available
        const docData = JSON.parse(modal.dataset.documentData || '{}');
        downloadFile(reportMarkdown, `${docData.filename || documentId}_Financial_Report.md`, 'text/markdown');
    } else if (documentId) {
        await exportReport(documentId, format);
    }
}

/**
 * Convert markdown to HTML with professional styling
 * @param {string} markdown - Markdown text
 * @returns {string} HTML content
 */
function convertMarkdownToHTML(markdown) {
    if (!markdown) return '<p>No report content available.</p>';
    
    let html = markdown;
    
    // Code blocks first (preserve them)
    const codeBlockPlaceholders = [];
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`;
        codeBlockPlaceholders.push(escapeHtml(code.trim()));
        return placeholder;
    });
    
    // Escape HTML to prevent XSS
    html = escapeHtml(html);
    
    // Restore code blocks
    codeBlockPlaceholders.forEach((code, idx) => {
        html = html.replace(`__CODE_BLOCK_${idx}__`, `<pre class="report-code-block"><code>${code}</code></pre>`);
    });
    
    // Headers
    html = html.replace(/^# (.*$)/gim, '<h1 class="report-h1">$1</h1>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="report-h2">$1</h2>');
    html = html.replace(/^### (.*$)/gim, '<h3 class="report-h3">$1</h3>');
    html = html.replace(/^#### (.*$)/gim, '<h4 class="report-h4">$1</h4>');
    
    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Blockquotes
    html = html.replace(/^> (.+)$/gim, '<blockquote class="report-blockquote">$1</blockquote>');
    
    // Horizontal rules
    html = html.replace(/^---$/gim, '<hr class="report-hr">');
    
    // Tables (markdown table format)
    html = html.replace(/\|(.+)\|/g, (match, content) => {
        const cells = content.split('|').map(c => c.trim()).filter(c => c);
        if (cells.length > 0) {
            // Check if it's a header separator
            if (cells.every(c => /^:?-+:?$/.test(c))) {
                return ''; // Skip separator rows
            }
            return '<tr>' + cells.map(cell => `<td class="report-table-cell">${cell}</td>`).join('') + '</tr>';
        }
        return match;
    });
    
    // Wrap consecutive table rows in table
    html = html.replace(/(<tr>[\s\S]*?<\/tr>(?:\s*<tr>[\s\S]*?<\/tr>)*)/g, (match) => {
        return `<table class="report-table">${match}</table>`;
    });
    
    // Lists (unordered)
    const lines = html.split('\n');
    const processedLines = [];
    let inList = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const listMatch = line.match(/^[\*\-] (.+)$/);
        const orderedMatch = line.match(/^\d+\. (.+)$/);
        
        if (listMatch || orderedMatch) {
            if (!inList) {
                processedLines.push(listMatch ? '<ul class="report-list">' : '<ol class="report-list">');
                inList = true;
            }
            const itemText = listMatch ? listMatch[1] : orderedMatch[1];
            processedLines.push(`<li class="report-list-item">${itemText}</li>`);
        } else {
            if (inList) {
                processedLines.push(listMatch ? '</ul>' : '</ol>');
                inList = false;
            }
            processedLines.push(line);
        }
    }
    
    if (inList) {
        processedLines.push('</ul>');
    }
    
    html = processedLines.join('\n');
    
    // Paragraphs (double newlines)
    html = html.split(/\n\n+/).map(para => {
        para = para.trim();
        if (!para) return '';
        // Don't wrap if it's already a block element
        if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|table|p)/.test(para)) {
            return para;
        }
        return `<p class="report-paragraph">${para}</p>`;
    }).join('\n');
    
    // Single newlines within paragraphs become <br>
    html = html.replace(/(<p class="report-paragraph">[\s\S]*?)<\/p>/g, (match, content) => {
        return content.replace(/\n/g, '<br>') + '</p>';
    });
    
    return `<div class="professional-report-content">${html}</div>`;
}

/**
 * Download file helper
 * @param {string} content - File content
 * @param {string} filename - File name
 * @param {string} mimeType - MIME type
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Filter reports by search term
 * @param {string} searchTerm - Search term
 */
function filterReports(searchTerm) {
    const cards = document.querySelectorAll('.report-card');
    const term = searchTerm.toLowerCase();
    
    cards.forEach(card => {
        const title = card.querySelector('.report-card-title')?.textContent.toLowerCase() || '';
        const content = card.querySelector('.report-card-preview')?.textContent.toLowerCase() || '';
        
        if (title.includes(term) || content.includes(term)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose functions globally for onclick handlers
window.loadReports = loadReports;
window.generateReportMarkdown = generateReportMarkdown;
window.viewReport = viewReport;
window.closeReportViewer = closeReportViewer;
window.exportReport = exportReport;
window.exportCurrentReport = exportCurrentReport;
