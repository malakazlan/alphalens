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
            const errorText = await response.text();
            let errorDetail = '';
            try {
                const errorJson = JSON.parse(errorText);
                errorDetail = errorJson.detail || errorText;
            } catch {
                errorDetail = errorText || response.statusText;
            }
            throw new Error(`Failed to generate report: ${errorDetail}`);
        }

        const reportData = await response.json();
        const report = reportData.report || '';

        // Validate that we got a detailed report (not the old basic format)
        if (!report || report.length < 500) {
            throw new Error('Report generation returned insufficient content. Please try again.');
        }

        // Check if it's the old basic format and reject it
        if (report.includes('# Document Report') && !report.includes('Document Analysis Report')) {
            throw new Error('Report generation returned basic format. Retrying with detailed generation...');
        }

        return report;
    } catch (error) {
        console.error('Error generating professional report:', error);
        // Don't use basic fallback - throw error so user knows to retry
        throw error;
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
                    <button class="report-view-btn" onclick="generateAndViewReport('${doc.document_id}')">Generate Report</button>
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
                    <button class="report-export-btn" onclick="exportCurrentReport('pdf')">📥 Download PDF</button>
                    <button class="report-export-btn" onclick="exportCurrentReport('markdown')">📄 Export MD</button>
                    <button class="report-export-btn" onclick="printReportOnly()">🖨️ Print</button>
                </div>
            </div>
        </div>
    `;

    reportsSection.innerHTML = html;

    // Ensure modal footer is updated after rendering (fixes cached modals)
    setTimeout(() => {
        ensureModalFooterIsUpdated();
    }, 100);

    // Add search functionality
    const searchInput = document.getElementById('reports-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            filterReports(e.target.value);
        });
    }
}

/**
 * Generate and view report for a specific document
 * This generates the report on-demand for the selected document only
 * @param {string} documentId - Document ID
 */
async function generateAndViewReport(documentId) {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        const headers = getAuthHeadersSafe();

        // Show loading state
        const modal = document.getElementById('report-viewer-modal');
        const modalTitle = document.getElementById('report-modal-title');
        const modalBody = document.getElementById('report-modal-body');

        if (modal && modalTitle && modalBody) {
            modalTitle.textContent = 'Generating Report...';
            modalBody.innerHTML = '<div class="loading-container"><div class="report-loading-spinner"></div><p>Generating detailed professional financial analysis report for this document...</p><p style="margin-top: 10px; font-size: 0.9em; color: var(--text-secondary);">This may take a few moments...</p></div>';
            modal.style.display = 'flex';
            // Hide header/footer when modal opens - do it immediately
            document.body.classList.add('report-modal-open');
            // Force hide with inline styles as backup
            const header = document.querySelector('header.main-header, .main-header, header');
            const footer = document.querySelector('footer.main-footer, .main-footer, footer');
            if (header) {
                header.style.display = 'none';
                header.style.visibility = 'hidden';
            }
            if (footer) {
                footer.style.display = 'none';
                footer.style.visibility = 'hidden';
            }
        }

        // Check document status first
        const docResponse = await fetch(`${apiBase}/documents/${documentId}`, {
            credentials: 'include',
            headers: headers
        });

        if (!docResponse.ok) {
            throw new Error('Failed to load document. Please ensure the document is processed.');
        }

        const docData = await docResponse.json();

        // Check if document is processed
        if (docData.status !== 'complete') {
            throw new Error(`Document is not ready. Current status: ${docData.status}. Please wait for processing to complete.`);
        }

        // Generate professional report directly from API endpoint
        // This ensures we get the detailed report for THIS document only
        const reportResponse = await fetch(`${apiBase}/documents/${documentId}/report`, {
            credentials: 'include',
            headers: headers
        });

        if (!reportResponse.ok) {
            const errorText = await reportResponse.text();
            let errorDetail = '';
            try {
                const errorJson = JSON.parse(errorText);
                errorDetail = errorJson.detail || errorText;
            } catch {
                errorDetail = errorText || reportResponse.statusText;
            }
            throw new Error(errorDetail || `Failed to generate report: ${reportResponse.statusText}`);
        }

        const reportData = await reportResponse.json();
        let reportMarkdown = reportData.report || '';

        if (!reportMarkdown || reportMarkdown.trim().length === 0) {
            throw new Error('Report generation returned empty content. Please try again.');
        }

        // Validate report format - ensure it's the detailed format, not the old basic one
        const hasDetailedHeader = reportMarkdown.includes('Document Analysis Report') ||
            reportMarkdown.includes('Executive Summary') ||
            reportMarkdown.includes('Comprehensive Table Analysis');
        const hasOldFormat = reportMarkdown.includes('# Document Report') &&
            reportMarkdown.includes('Document Overview') &&
            !reportMarkdown.includes('Document Analysis Report');

        if (hasOldFormat || (!hasDetailedHeader && reportMarkdown.length < 2000)) {
            console.warn('Report appears to be in old format, but continuing...');
            // Still show it, but log a warning
        }

        if (modal && modalTitle && modalBody) {
            modalTitle.textContent = `Financial Analysis Report: ${docData.filename || documentId}`;

            // Convert markdown to HTML with professional styling
            const htmlContent = convertMarkdownToHTML(reportMarkdown);
            modalBody.innerHTML = htmlContent;

            // Store current document for export
            modal.dataset.documentId = documentId;
            modal.dataset.documentData = JSON.stringify(docData);
            modal.dataset.reportMarkdown = reportMarkdown;

            // Ensure footer buttons are correct (in case modal was created with old HTML)
            ensureModalFooterIsUpdated();

            // Ensure header/footer are hidden (in case they weren't hidden during loading)
            document.body.classList.add('report-modal-open');
            const header = document.querySelector('header.main-header, .main-header, header');
            const footer = document.querySelector('footer.main-footer, .main-footer, footer');
            if (header) {
                header.style.display = 'none';
                header.style.visibility = 'hidden';
            }
            if (footer) {
                footer.style.display = 'none';
                footer.style.visibility = 'hidden';
            }
        }
    } catch (error) {
        console.error('Error generating report:', error);
        const modalBody = document.getElementById('report-modal-body');
        const modalTitle = document.getElementById('report-modal-title');
        if (modalTitle) {
            modalTitle.textContent = 'Error Generating Report';
        }
        if (modalBody) {
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--error);">
                    <p style="font-size: 1.1em; margin-bottom: 16px;"><strong>Failed to generate report</strong></p>
                    <p style="margin-bottom: 24px;">${error.message || 'Please try again.'}</p>
                    <button class="report-view-btn" onclick="generateAndViewReport('${documentId}')" style="margin-top: 16px;">Retry</button>
                </div>
            `;
        }
    }
}

/**
 * View a specific report (legacy function - kept for compatibility)
 * @param {string} documentId - Document ID
 */
async function viewReport(documentId) {
    // Redirect to generate and view
    return generateAndViewReport(documentId);
}

/**
 * Handle keyboard shortcuts for report viewer
 * @param {KeyboardEvent} event - Keyboard event
 */
function handleReportKeyboardShortcuts(event) {
    // Ctrl+P or Cmd+P - Print report only
    if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        printReportOnly();
        return false;
    }
    // Escape - Close modal
    if (event.key === 'Escape') {
        closeReportViewer();
    }
}

/**
 * Close report viewer modal
 */
function closeReportViewer() {
    const modal = document.getElementById('report-viewer-modal');
    if (modal) {
        modal.style.display = 'none';
        // Remove class to show header/footer again
        document.body.classList.remove('report-modal-open');
        // Restore header/footer visibility
        const header = document.querySelector('header.main-header, .main-header, header');
        const footer = document.querySelector('footer.main-footer, .main-footer, footer');
        if (header) {
            header.style.display = '';
            header.style.visibility = '';
        }
        if (footer) {
            footer.style.display = '';
            footer.style.visibility = '';
        }
    }
}

/**
 * Ensure modal footer has correct buttons (fixes old cached modals)
 */
function ensureModalFooterIsUpdated() {
    const modal = document.getElementById('report-viewer-modal');
    if (!modal) return;

    const footer = modal.querySelector('.report-modal-footer');
    if (footer) {
        // Check if footer has old buttons
        const hasOldPrint = footer.innerHTML.includes("exportCurrentReport('print')");
        const hasOldSave = footer.innerHTML.includes("Save as PDF");

        if (hasOldPrint || hasOldSave) {
            // Update footer with new buttons
            footer.innerHTML = `
                <button class="report-export-btn" onclick="exportCurrentReport('pdf')">📥 Download PDF</button>
                <button class="report-export-btn" onclick="exportCurrentReport('markdown')">📄 Export MD</button>
                <button class="report-export-btn" onclick="printReportOnly()">🖨️ Print</button>
            `;
            console.log('Updated report modal footer buttons');
        }
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
    const modalBody = document.getElementById('report-modal-body');

    if (format === 'markdown' && reportMarkdown) {
        // Use cached report if available
        const docData = JSON.parse(modal.dataset.documentData || '{}');
        downloadFile(reportMarkdown, `${docData.filename || documentId}_Financial_Report.md`, 'text/markdown');
    } else if (format === 'pdf') {
        // Generate proper PDF download using html2pdf.js
        if (modalBody) {
            try {
                // Load html2pdf.js dynamically if not already loaded
                if (typeof html2pdf === 'undefined') {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
                        script.onload = resolve;
                        script.onerror = () => reject(new Error('Failed to load html2pdf.js'));
                        document.head.appendChild(script);
                    });
                }
                await generatePDFDownload(modalBody, documentId);
            } catch (error) {
                console.error('PDF generation error:', error);
                alert('PDF generation failed: ' + (error.message || 'Unknown error') + '. Please try the print option instead.');
            }
        } else {
            alert('Report content not available for PDF generation.');
        }
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

    // Headers (process in reverse order to avoid conflicts)
    html = html.replace(/^#### (.*$)/gim, '<h4 class="report-h4">$1</h4>');
    html = html.replace(/^### (.*$)/gim, '<h3 class="report-h3">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="report-h2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="report-h1">$1</h1>');

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

    // Tables (markdown table format) - improved handling
    // First, identify and process table blocks
    const lines = html.split('\n');
    const processedLines = [];
    let tableRows = [];
    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        const isTableRow = /^\|(.+)\|$/.test(trimmedLine);

        if (isTableRow) {
            const cells = trimmedLine.split('|').map(c => c.trim()).filter(c => c);
            // Check if it's a header separator
            if (cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c))) {
                // Skip separator rows but don't break table
                continue;
            }

            if (!inTable) {
                inTable = true;
            }
            tableRows.push({ cells: cells, originalLine: i });
        } else {
            if (inTable && tableRows.length > 0) {
                // Process accumulated table rows
                let tableHTML = '<table class="report-table">';
                if (tableRows.length > 0) {
                    // First row is header
                    tableHTML += '<thead><tr>';
                    tableRows[0].cells.forEach(cell => {
                        tableHTML += `<th class="report-table-cell">${cell}</th>`;
                    });
                    tableHTML += '</tr></thead>';

                    // Remaining rows are body
                    if (tableRows.length > 1) {
                        tableHTML += '<tbody>';
                        for (let j = 1; j < tableRows.length; j++) {
                            tableHTML += '<tr>';
                            tableRows[j].cells.forEach(cell => {
                                tableHTML += `<td class="report-table-cell">${cell}</td>`;
                            });
                            tableHTML += '</tr>';
                        }
                        tableHTML += '</tbody>';
                    }
                }
                tableHTML += '</table>';
                processedLines.push(tableHTML);
                tableRows = [];
                inTable = false;
            }
            processedLines.push(line);
        }
    }

    // Handle table at end of document
    if (inTable && tableRows.length > 0) {
        let tableHTML = '<table class="report-table">';
        if (tableRows.length > 0) {
            tableHTML += '<thead><tr>';
            tableRows[0].cells.forEach(cell => {
                tableHTML += `<th class="report-table-cell">${cell}</th>`;
            });
            tableHTML += '</tr></thead>';

            if (tableRows.length > 1) {
                tableHTML += '<tbody>';
                for (let j = 1; j < tableRows.length; j++) {
                    tableHTML += '<tr>';
                    tableRows[j].cells.forEach(cell => {
                        tableHTML += `<td class="report-table-cell">${cell}</td>`;
                    });
                    tableHTML += '</tr>';
                }
                tableHTML += '</tbody>';
            }
        }
        tableHTML += '</table>';
        processedLines.push(tableHTML);
    }

    html = processedLines.join('\n');

    // Lists (unordered) - process after tables
    const listLines = html.split('\n');
    const processedListLines = [];
    let inList = false;

    for (let i = 0; i < listLines.length; i++) {
        const line = listLines[i];
        const listMatch = line.match(/^[\*\-] (.+)$/);
        const orderedMatch = line.match(/^\d+\. (.+)$/);

        if (listMatch || orderedMatch) {
            if (!inList) {
                processedListLines.push(listMatch ? '<ul class="report-list">' : '<ol class="report-list">');
                inList = true;
            }
            const itemText = listMatch ? listMatch[1] : orderedMatch[1];
            processedListLines.push(`<li class="report-list-item">${itemText}</li>`);
        } else {
            if (inList) {
                processedListLines.push('</ul>');
                inList = false;
            }
            processedListLines.push(line);
        }
    }

    if (inList) {
        processedListLines.push('</ul>');
    }

    html = processedListLines.join('\n');

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
window.generateAndViewReport = generateAndViewReport;
window.closeReportViewer = closeReportViewer;
window.exportReport = exportReport;
/**
 * Generate and download PDF using html2pdf.js
 * @param {HTMLElement} element - Element to convert to PDF
 * @param {string} documentId - Document ID for filename
 */
async function generatePDFDownload(element, documentId) {
    const modal = document.getElementById('report-viewer-modal');
    const modalBody = document.getElementById('report-modal-body');
    const docData = modal ? JSON.parse(modal.dataset.documentData || '{}') : {};
    const filename = `${(docData.filename || documentId || 'report').replace(/\.(pdf|docx?|txt)$/i, '')}_Financial_Report.pdf`;

    // Check if libraries are loaded
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
        alert('PDF libraries not loaded. Please refresh the page.');
        return;
    }

    if (!modalBody) {
        alert('Report content not available.');
        return;
    }

    // Capture content FIRST (before showing loading)
    let clone = null;
    try {
        // Get actual dimensions from the original element
        const originalWidth = modalBody.scrollWidth || modalBody.offsetWidth || 1200;
        const originalHeight = modalBody.scrollHeight || modalBody.offsetHeight;
        
        // Create a deep clone of the element
        clone = modalBody.cloneNode(true);
        
        // Copy computed styles to ensure all CSS is preserved
        const computedStyle = window.getComputedStyle(modalBody);
        clone.style.cssText = computedStyle.cssText;
        
        // Override positioning and visibility for off-screen rendering
        clone.style.position = 'absolute';
        clone.style.left = '-9999px';
        clone.style.top = '0';
        clone.style.width = originalWidth + 'px';
        clone.style.height = 'auto';
        clone.style.minHeight = originalHeight + 'px';
        clone.style.maxWidth = 'none';
        clone.style.maxHeight = 'none';
        clone.style.overflow = 'visible';
        clone.style.zIndex = '-1';
        clone.style.visibility = 'visible';
        clone.style.opacity = '1';
        clone.style.display = 'block';
        clone.id = 'pdf-clone-' + Date.now(); // Unique ID to avoid conflicts

        // Append to body so it renders
        document.body.appendChild(clone);
        
        // Wait for layout to calculate
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Wait for all images to load
        const images = clone.querySelectorAll('img');
        if (images.length > 0) {
            await Promise.all(Array.from(images).map(img => {
                if (img.complete) return Promise.resolve();
                return new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = resolve; // Continue even if image fails
                    setTimeout(resolve, 2000); // Max 2s wait per image
                });
            }));
        }
        
        // Verify clone has dimensions
        const cloneWidth = clone.offsetWidth || clone.scrollWidth;
        const cloneHeight = clone.offsetHeight || clone.scrollHeight;
        
        if (cloneWidth === 0 || cloneHeight === 0) {
            throw new Error(`Clone has zero dimensions: ${cloneWidth}x${cloneHeight}`);
        }

        // Use html2canvas to capture the clone
        const canvas = await html2canvas(clone, {
            scale: 2,
            useCORS: true,
            logging: false,
            backgroundColor: '#ffffff',
            width: cloneWidth,
            height: cloneHeight,
            windowWidth: cloneWidth,
            windowHeight: cloneHeight
        });

        const imgData = canvas.toDataURL('image/png');

        // Create PDF
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const margin = 10;
        const contentWidth = pdfWidth - (margin * 2);

        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = imgWidth / imgHeight;
        const contentHeight = contentWidth / ratio;

        // Add image to PDF
        if (contentHeight <= pdfHeight - (margin * 2)) {
            // Single page
            pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
        } else {
            // Multiple pages
            let heightLeft = contentHeight;
            let position = margin;

            pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
            heightLeft -= (pdfHeight - margin * 2);

            while (heightLeft > 0) {
                position = heightLeft - contentHeight + margin;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', margin, position, contentWidth, contentHeight);
                heightLeft -= (pdfHeight - margin * 2);
            }
        }

        // Save PDF
        pdf.save(filename);

    } catch (err) {
        console.error('PDF generation error:', err);
        alert('PDF generation failed: ' + (err.message || 'Unknown error') + '. Using print option instead.');
        printReportOnly();
    } finally {
        // Clean up the clone - ensure it's completely removed
        if (clone) {
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
            clone = null;
        }
        
        // Also clean up any leftover clones (in case of errors)
        const leftoverClones = document.querySelectorAll('[id^="pdf-clone-"]');
        leftoverClones.forEach(clone => {
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
        });
        
        // Ensure report-modal-open class is removed (in case modal wasn't closed properly)
        document.body.classList.remove('report-modal-open');
    }
}

/**
 * Print only the report content (not the whole page)
 */
function printReportOnly() {
    const modal = document.getElementById('report-viewer-modal');
    const modalBody = document.getElementById('report-modal-body');
    const documentId = modal ? modal.dataset.documentId : 'report';

    if (!modalBody) {
        alert('Report content not available for printing.');
        return;
    }

    // Create a new window with only the report content
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Please allow popups to print the report.');
        return;
    }

    const docData = modal ? JSON.parse(modal.dataset.documentData || '{}') : {};
    const reportTitle = docData.filename || documentId || 'Financial Report';

    const printContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${reportTitle} - Financial Report</title>
    <style>
        @page {
            margin: 20mm;
            size: A4;
        }
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Inter', 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
            padding: 40px;
            line-height: 1.8;
            color: #1a1a1a;
            background: white;
        }
        h1 {
            font-size: 2.5rem;
            border-bottom: 3px solid #059669;
            padding-bottom: 1rem;
            margin-bottom: 1.5rem;
            color: #059669;
        }
        h2 {
            font-size: 1.75rem;
            margin-top: 2rem;
            margin-bottom: 1rem;
            border-left: 4px solid #059669;
            padding-left: 1rem;
            color: #1a1a1a;
        }
        h3 {
            font-size: 1.4rem;
            margin-top: 1.5rem;
            margin-bottom: 0.75rem;
            color: #1a1a1a;
        }
        h4 {
            font-size: 1.2rem;
            margin-top: 1rem;
            margin-bottom: 0.5rem;
        }
        p {
            margin-bottom: 1rem;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            page-break-inside: avoid;
        }
        table th {
            background: #059669;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        table td {
            padding: 10px;
            border: 1px solid #e2e8f0;
        }
        table tr:nth-child(even) {
            background: #f5f7fa;
        }
        ul, ol {
            margin-left: 2rem;
            margin-bottom: 1rem;
        }
        li {
            margin-bottom: 0.5rem;
        }
        blockquote {
            border-left: 4px solid #059669;
            padding-left: 1rem;
            margin: 1rem 0;
            color: #4a5568;
        }
        hr {
            border: none;
            border-top: 2px solid #e2e8f0;
            margin: 2rem 0;
        }
        strong {
            font-weight: 600;
            color: #1a1a1a;
        }
        @media print {
            body {
                padding: 0;
            }
            @page {
                margin: 15mm;
            }
        }
    </style>
</head>
<body>
    ${modalBody.innerHTML}
</body>
</html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
    printWindow.focus();

    // Wait for content to load, then print
    setTimeout(() => {
        printWindow.print();
        // Don't close immediately - let user see the print dialog
    }, 500);
}

window.exportCurrentReport = exportCurrentReport;
window.generatePDFDownload = generatePDFDownload;
window.printReportOnly = printReportOnly;
window.ensureModalFooterIsUpdated = ensureModalFooterIsUpdated;

// Global keyboard shortcut handler for Ctrl+P when report modal is open
document.addEventListener('keydown', (event) => {
    const modal = document.getElementById('report-viewer-modal');
    if (modal && modal.style.display !== 'none') {
        // Ctrl+P or Cmd+P - Print report only (not whole page)
        if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
            event.preventDefault();
            event.stopPropagation();
            printReportOnly();
            return false;
        }
    }
});
