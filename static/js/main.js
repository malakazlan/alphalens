// PDF.js setup
if (window['pdfjs-dist/build/pdf']) {
    window.pdfjsLib = window['pdfjs-dist/build/pdf'];
}
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// API endpoint
const API_BASE_URL = window.location.origin;

// Store the currently selected document
let selectedDocumentId = null;
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
        } else {
            // Not authenticated, redirect to login
            window.location.href = '/login';
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = '/login';
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

// Show homepage
function showHomePage() {
    // Hide all sections
    const homepageSection = document.getElementById('homepage-section');
    const analyzerSection = document.getElementById('analyzer-section');
    const finbotSection = document.getElementById('finbot-section');
    const reportsSection = document.getElementById('reports-section');
    const optimizerSection = document.getElementById('optimizer-section');
    const spreadsheetSection = document.getElementById('spreadsheet-section');
    
    if (homepageSection) homepageSection.style.display = 'block';
    if (analyzerSection) analyzerSection.style.display = 'none';
    if (finbotSection) finbotSection.style.display = 'none';
    if (reportsSection) reportsSection.style.display = 'none';
    if (optimizerSection) optimizerSection.style.display = 'none';
    if (spreadsheetSection) spreadsheetSection.style.display = 'none';
    
    // Update nav links
    updateNavLinks('home');
}

// Feature switching function
function showFeature(feature) {
    // Hide homepage
    const homepageSection = document.getElementById('homepage-section');
    if (homepageSection) homepageSection.style.display = 'none';
    
    // Get all sections
    const analyzerSection = document.getElementById('analyzer-section');
    const finbotSection = document.getElementById('finbot-section');
    const reportsSection = document.getElementById('reports-section');
    const optimizerSection = document.getElementById('optimizer-section');
    const spreadsheetSection = document.getElementById('spreadsheet-section');
    
    // Hide all sections first
    if (analyzerSection) analyzerSection.style.display = 'none';
    if (finbotSection) finbotSection.style.display = 'none';
    if (reportsSection) reportsSection.style.display = 'none';
    if (optimizerSection) optimizerSection.style.display = 'none';
    if (spreadsheetSection) spreadsheetSection.style.display = 'none';
    
    // Show the selected section
    if (feature === 'analyzer') {
        if (analyzerSection) analyzerSection.style.display = 'grid';
        updateNavLinks('analyzer');
        // Set up upload form listener when analyzer section is shown
        setTimeout(() => {
            const form = document.getElementById('upload-form');
            if (form && !form.hasAttribute('data-listener-attached')) {
                form.addEventListener('submit', uploadDocument);
                form.setAttribute('data-listener-attached', 'true');
            }
        }, 100);
    } else if (feature === 'finbot') {
        if (finbotSection) finbotSection.style.display = 'block';
        updateNavLinks('chatbot');
    } else if (feature === 'reports') {
        if (reportsSection) reportsSection.style.display = 'block';
        updateNavLinks('reports');
    } else if (feature === 'optimizer') {
        if (optimizerSection) optimizerSection.style.display = 'block';
        updateNavLinks('optimizer');
    } else if (feature === 'spreadsheet') {
        if (spreadsheetSection) spreadsheetSection.style.display = 'block';
        updateNavLinks('spreadsheet');
    }
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Update navigation links active state
function updateNavLinks(activeLink) {
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.classList.remove('active');
        const linkText = link.textContent.toLowerCase();
        if (activeLink === 'home' && linkText === 'home') {
            link.classList.add('active');
        } else if (activeLink === 'analyzer' && linkText === 'analyzer') {
            link.classList.add('active');
        } else if (activeLink === 'reports' && linkText === 'reports') {
            link.classList.add('active');
        } else if (activeLink === 'optimizer' && linkText === 'optimizer') {
            link.classList.add('active');
        } else if (activeLink === 'chatbot' && linkText === 'chatbot') {
            link.classList.add('active');
        } else if (activeLink === 'spreadsheet' && linkText === 'spreadsheet') {
            link.classList.add('active');
        }
    });
}

// DOM elements
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const documentList = document.getElementById('document-list');
const documentView = document.getElementById('document-view');
const documentStatus = document.getElementById('document-status');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendButton = document.getElementById('chat-send');
const pdfCanvas = document.getElementById('pdf-canvas');
const pdfWrapper = document.getElementById('pdf-wrapper');
const pdfOverlay = document.getElementById('pdf-overlay');
const pdfPrevButton = document.getElementById('pdf-prev');
const pdfNextButton = document.getElementById('pdf-next');
const pageIndicator = document.getElementById('page-indicator');
const pdfContext = pdfCanvas ? pdfCanvas.getContext('2d') : null;
let pdfDocInstance = null;
let currentPdfPage = 1;
let currentOverlayChunks = [];

// Check authentication first, then load documents
window.addEventListener('DOMContentLoaded', async () => {
    await checkAuthentication();
    // Show homepage by default
    showHomePage();
    loadDocuments();
});

// Handle window resize for responsive PDF overlays
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Redraw all PDF pages on resize if we're showing all pages
        if (pdfDocInstance && pdfWrapper && pdfWrapper.querySelector('.pdf-page-container')) {
            renderAllPdfPages();
        } else if (pdfDocInstance && currentPdfPage) {
            // Fallback to single page render
            renderPdfPage(currentPdfPage);
        }
    }, 250);
});

// Set up form submission for document upload (with null check)
if (uploadForm) {
    uploadForm.addEventListener('submit', uploadDocument);
} else {
    // If form doesn't exist yet, set up listener when analyzer is shown
    // This is handled in showFeature function
}

// Event listeners are now set up in initializeDOMElements()

// Tab switching functionality
document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        // Update active tab
        document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show/hide content
        document.querySelectorAll('[id$="-tab-content"]').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`${tabName}-tab-content`);
        if (activeContent) {
            activeContent.style.display = 'block';
        }
    });
});

// Markdown/JSON view switching
document.querySelectorAll('.parse-view-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const viewType = tab.dataset.view;
        
        // Update active tab
        document.querySelectorAll('.parse-view-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show/hide views
        document.getElementById('markdown-view').style.display = viewType === 'markdown' ? 'block' : 'none';
        document.getElementById('json-view').style.display = viewType === 'json' ? 'block' : 'none';
    });
});

// Function to load documents
async function loadDocuments() {
    try {
        const response = await fetch(`${API_BASE_URL}/documents`, {
            credentials: 'include',
            headers: getAuthHeaders()
        });
        
        // Handle 401 - redirect to login
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to load documents');
        }
        
        const documents = await response.json();
        displayDocuments(documents);
        
        // Start polling for document status if there are documents
        if (documents.length > 0) {
            pollDocumentStatus();
        }
    } catch (error) {
        console.error('Error loading documents:', error);
        // Only update documentStatus if it exists
        if (documentStatus) {
            documentStatus.innerHTML = `<div class="status-banner error">Error loading documents: ${error.message}</div>`;
        } else {
            // Fallback: show error in upload-status if available
            const uploadStatus = document.getElementById('upload-status');
            if (uploadStatus) {
                uploadStatus.innerHTML = `<div class="status-banner error">Error loading documents: ${error.message}</div>`;
            }
        }
    }
}

// Function to display documents
function displayDocuments(documents) {
    if (!documentList) {
        console.error('Document list element not found');
        return;
    }
    
    if (documents.length === 0) {
        documentList.innerHTML = '<p class="doc-meta">No documents yet. Upload a PDF to get started.</p>';
        // Only update hero-doc-count if it exists (homepage only)
        const heroDocCount = document.getElementById('hero-doc-count');
        if (heroDocCount) {
            heroDocCount.textContent = '0';
        }
        return;
    }
    
    documentList.innerHTML = '';
    // Only update hero-doc-count if it exists (homepage only)
    const heroDocCount = document.getElementById('hero-doc-count');
    if (heroDocCount) {
        heroDocCount.textContent = documents.length;
    }
    
    documents.forEach(doc => {
        const listItem = document.createElement('li');
        listItem.className = 'document-item';
        listItem.dataset.id = doc.document_id;
        listItem.innerHTML = `
            <p class="doc-name">${doc.filename || doc.document_id}</p>
            <p class="doc-meta">Uploaded ${doc.upload_time || 'unknown'}</p>
            <span class="status-chip ${doc.status}">
                ${doc.status}
            </span>
        `;
        
        listItem.addEventListener('click', () => selectDocument(doc.document_id));
        
        documentList.appendChild(listItem);
    });
}

// Function to upload a document
async function uploadDocument(e) {
    e.preventDefault();
    
    // Re-get elements in case they weren't initialized
    const currentFileInput = document.getElementById('file-input');
    const currentUploadStatus = document.getElementById('upload-status');
    
    if (!currentFileInput || !currentUploadStatus) {
        console.error('Upload elements not found');
        return;
    }
    
    const file = currentFileInput.files[0];
    
    if (!file) {
        currentUploadStatus.innerHTML = '<div class="status-banner error">Please select a file</div>';
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    currentUploadStatus.innerHTML = '<div class="status-banner processing">Uploading document...</div>';
    
    try {
        const headers = {};
        const token = getAuthToken();
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch(`${API_BASE_URL}/documents/upload`, {
            method: 'POST',
            credentials: 'include',
            headers: headers,
            body: formData,
        });
        
        // Handle 401 - redirect to login
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to upload document');
        }
        
        const data = await response.json();
        currentUploadStatus.innerHTML = '<div class="status-banner processing">Document uploaded and processing...</div>';
        
        // Auto-select the uploaded document
        if (data.document_id) {
            selectedDocumentId = data.document_id;
        }
        
        // Clear the file input
        currentFileInput.value = '';
        
        // Start polling for document status
        pollDocumentStatus();
        
        // Load documents again to update the list
        loadDocuments();
    } catch (error) {
        console.error('Error uploading document:', error);
        const errorUploadStatus = document.getElementById('upload-status');
        if (errorUploadStatus) {
            errorUploadStatus.innerHTML = `<div class="status-banner error">Error uploading document: ${error.message}</div>`;
        }
    }
}

// Function to poll document status
let pollingInterval = null;

function pollDocumentStatus() {
    // Clear any existing polling interval
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }
    
    pollingInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/documents`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            
            // Handle 401 - redirect to login
            if (response.status === 401) {
                clearInterval(pollingInterval);
                pollingInterval = null;
                window.location.href = '/login';
                return;
            }
            
            if (!response.ok) {
                throw new Error('Failed to fetch document status');
            }
            
            const documents = await response.json();
            
            // Update the document list
            displayDocuments(documents);
            
            // If no document is selected but we have documents, select the first complete one or first one
            if (!selectedDocumentId && documents.length > 0) {
                // Prefer completed documents, otherwise select first one
                const completedDoc = documents.find(doc => doc.status === 'complete');
                selectedDocumentId = completedDoc ? completedDoc.document_id : documents[0].document_id;
                
                // Highlight it in the list
                document.querySelectorAll('.document-item').forEach(item => {
                    item.classList.remove('active');
                    if (item.dataset.id === selectedDocumentId) {
                        item.classList.add('active');
                    }
                });
            }
            
            // Update status for the selected document if any
            if (selectedDocumentId) {
                const selectedDoc = documents.find(doc => doc.document_id === selectedDocumentId);
                
                if (selectedDoc) {
                    updateDocumentView(selectedDoc);
                    
                    // Update upload status message
                    const statusElement = document.getElementById('upload-status');
                    if (statusElement && selectedDoc.status === 'processing') {
                        statusElement.innerHTML = '<div class="status-banner processing">Processing document... This may take a moment.</div>';
                    } else if (statusElement && selectedDoc.status === 'complete') {
                        statusElement.innerHTML = '<div class="status-banner complete">Document processed successfully!</div>';
                        setTimeout(() => {
                            if (statusElement) {
                                statusElement.innerHTML = '';
                            }
                        }, 3000);
                    }
                }
            }
            
            // Check if all documents are processed
            const allProcessed = documents.length > 0 && documents.every(doc => doc.status === 'complete' || doc.status === 'error');
            
            // If all documents are processed, stop polling
            if (allProcessed) {
                clearInterval(pollingInterval);
                pollingInterval = null;
                const statusElement = document.getElementById('upload-status');
                if (statusElement && documents.every(doc => doc.status === 'complete')) {
                    statusElement.innerHTML = '<div class="status-banner complete">All documents processed!</div>';
                    setTimeout(() => {
                        if (statusElement) {
                            statusElement.innerHTML = '';
                        }
                    }, 3000);
                }
            }
        } catch (error) {
            console.error('Error polling document status:', error);
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    }, 2000); // Poll every 2 seconds for faster updates
}

// Function to select a document
async function selectDocument(documentId) {
    selectedDocumentId = documentId;
    
    // Clear any existing polling and restart to get fresh data
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    
    // Highlight the selected document
    document.querySelectorAll('.document-item').forEach(item => {
        item.classList.remove('active');
        
        if (item.dataset.id === documentId) {
            item.classList.add('active');
        }
    });
    
    // Restart polling to get updated document data
    pollDocumentStatus();
    
    try {
        const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
            credentials: 'include',
            headers: getAuthHeaders()
        });
        
        // Handle 401 - redirect to login
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            throw new Error('Failed to load document details');
        }
        
        const document = await response.json();
        updateDocumentView(document);
        
        // Clear chat messages
        chatMessages.innerHTML = '';
    } catch (error) {
        console.error('Error loading document details:', error);
        documentView.innerHTML = `<div class="status-banner error">Error loading document details: ${error.message}</div>`;
    }
}

// Function to update document view
function updateDocumentView(docData) {
    console.log('Updating document view:', docData);
    
    // Update parse panel with markdown/JSON - use window.document to avoid conflict
    const markdownView = window.document.getElementById('markdown-view');
    const jsonView = window.document.getElementById('json-content');
    
    if (!markdownView || !jsonView) {
        console.error('Parse panel elements not found!', { markdownView, jsonView });
        return;
    }
    
    if (docData.document_markdown) {
        // Format markdown like Landing.AI - structured with numbered sections
        const formattedMarkdown = formatMarkdownLikeLandingAI(docData);
        markdownView.innerHTML = formattedMarkdown;
        
        // Add click handlers to markdown sections for interactive region detection
        setupMarkdownInteractivity();
        
        // Show JSON in Landing.AI format
        const jsonData = {
            markdown: docData.document_markdown || '',
            chunks: docData.detected_chunks || [],
            splits: docData.splits || [],
            grounding: docData.grounding || {},
            metadata: docData.metadata || {}
        };
        jsonView.textContent = JSON.stringify(jsonData, null, 2);
        
        console.log('Parse panel updated with markdown and JSON');
    } else {
        markdownView.innerHTML = '<p class="doc-meta">No parsed data available yet. Document is still processing...</p>';
        jsonView.textContent = '';
        console.log('Document markdown not available yet');
    }
    
    // Load PDF if available
    if (docData.status === 'complete' && pdfCanvas) {
        renderDocumentPreview(docData);
    }
    
    let statusClass = 'processing';
    
    if (docData.status === 'complete') {
        statusClass = 'complete';
    } else if (docData.status === 'error') {
        statusClass = 'error';
    }
    
    // Note: The old document-view section is now replaced by parse panel
    // We keep this for backward compatibility but it's not displayed in new layout
    let html = '';
    
    if (docData.metadata) {
        html += `
            <div class="metadata-grid">
                <div class="metadata-item">
                    <span class="label">Company</span>
                    <span class="value">${docData.metadata.company_name || '—'}</span>
                </div>
                <div class="metadata-item">
                    <span class="label">Document Type</span>
                    <span class="value">${docData.metadata.document_type || '—'}</span>
                </div>
                <div class="metadata-item">
                    <span class="label">Document Date</span>
                    <span class="value">${docData.metadata.document_date || '—'}</span>
                </div>
            </div>
        `;
    }
    
    if (docData.summary) {
        html += `
            <div class="insight-block">
                <h3>Executive Summary</h3>
                <p>${docData.summary}</p>
            </div>
        `;
    }
    
    if (docData.key_metrics && docData.key_metrics.length > 0) {
        html += `
            <div class="metrics-section">
                <h3>Key Metrics</h3>
                <div class="metrics-grid">
        `;
        
        docData.key_metrics.forEach(metric => {
            html += `
                <div class="metric-pill">
                    <span class="label">${metric.name}</span>
                    <span class="value">${formatValue(metric.value, metric.unit)}</span>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    }

    if (docData.tables && docData.tables.length > 0) {
        html += renderTablesSection(docData.tables);
    }
    
    if (docData.document_markdown) {
        // Show full markdown - no truncation since tables are already parsed and shown separately
        // This is the raw Landing.AI markdown output for reference
        html += `
            <div class="insight-block doc-preview">
                <h3>Raw Document Markdown (Landing.AI Output)</h3>
                <p class="doc-meta">Full parsed markdown from Landing.AI - all pages included</p>
                <pre>${escapeHtml(docData.document_markdown)}</pre>
            </div>
        `;
    }
    
    if (docData.detected_chunks && docData.detected_chunks.length > 0) {
        // Show ALL chunks from all pages - Landing.AI detects everything
        const allChunks = docData.detected_chunks;
        const totalChunks = allChunks.length;
        
        html += `
            <div class="detected-section">
                <h3>Detected Regions</h3>
                <p class="doc-meta">Showing ${totalChunks} regions identified by Landing.AI across all pages</p>
                <div class="detected-grid">
        `;
        
        allChunks.forEach(chunk => {
            const snippet = chunk.text ? chunk.text.slice(0, 220) : 'No text available';
            const shortened = chunk.text && chunk.text.length > 220;
            const location = typeof chunk.page === 'number' ? `Page ${chunk.page + 1}` : 'Page n/a';
            const boxLabel = chunk.box ? formatBoundingBox(chunk.box) : '';
            
            html += `
                <div class="detected-card">
                    <div class="detected-card-header">
                        <span>${(chunk.type || 'chunk').toUpperCase()}</span>
                        <span>${location}</span>
                    </div>
                    <p>${escapeHtml(snippet)}${shortened ? '…' : ''}</p>
                    ${boxLabel ? `<span class="doc-meta">bbox: ${boxLabel}</span>` : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    }
    
    // Note: documentView is kept for backward compatibility but not used in new layout
    // The parse panel is the main display area now
    if (documentView) {
        documentView.innerHTML = html;
        bindTableInteractions(docData.tables || []);
    }
}

// Function to format values
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

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Format markdown like Landing.AI - structured with numbered sections and proper table rendering
function formatMarkdownLikeLandingAI(docData) {
    let html = '';
    const markdown = docData.document_markdown || '';
    
    if (!markdown) {
        return '<p class="doc-meta">No parsed data available</p>';
    }
    
    // Reset counters for consistent numbering
    resetCounters();
    
    // Pre-assign numbers to all chunks
    if (docData.detected_chunks && docData.detected_chunks.length > 0) {
        docData.detected_chunks.forEach(chunk => {
            const chunkType = (chunk.type || 'text').toLowerCase();
            getNumberedLabel(chunkType, chunk.id || '');
        });
    }
    
    // If we have chunks, use them for better structure (like Landing.AI)
    if (docData.detected_chunks && docData.detected_chunks.length > 0) {
        // Group chunks by type and render them
        docData.detected_chunks.forEach(chunk => {
            // Get markdown - prioritize markdown field, then text, then content
            const chunkMarkdown = chunk.markdown || chunk.text || chunk.content || '';
            const chunkType = chunk.type || 'text';
            
            if (!chunkMarkdown.trim()) return;
            
            // Get numbered label for this chunk
            const numberedLabel = getNumberedLabel(chunkType.toLowerCase(), chunk.id || '');
            
            // Determine section type from chunk type
            let sectionType = 'Text';
            if (chunkType === 'marginalia') {
                sectionType = 'Marginalia';
            } else if (chunkType === 'table') {
                sectionType = 'Table';
            } else if (chunkType === 'chart' || chunkType === 'graph') {
                sectionType = 'Chart';
            } else {
                sectionType = 'Text';
            }
            
            // Extract content - if it contains tables, render them properly
            let content = '';
            
            // Check for tables in the markdown
            const tableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
            const tables = chunkMarkdown.match(tableRegex) || [];
            
            if (tables.length > 0) {
                // Extract text before first table
                let textBefore = chunkMarkdown.split('<table')[0].trim();
                textBefore = textBefore.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').trim();
                
                if (textBefore) {
                    content += `<div style="margin-bottom: 16px; font-weight: 600; color: var(--text);">${escapeHtml(textBefore).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`;
                }
                
                // Render each table as proper HTML
                tables.forEach((tableHTML, idx) => {
                    if (idx > 0) {
                        content += '<div style="margin-top: 24px;"></div>';
                    }
                    // Find the position of this table in the chunk markdown
                    const tableIndex = chunkMarkdown.indexOf(tableHTML);
                    const textBeforeTable = tableIndex > 0 ? chunkMarkdown.substring(0, tableIndex) : '';
                    const formattedTable = formatTableHTML(tableHTML, textBeforeTable);
                    content += formattedTable;
                });
            } else {
                // For text/marginalia, clean up anchor tags and format
                const cleaned = chunkMarkdown
                    .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '') // Remove anchor tags
                    .replace(/\n\n+/g, '\n\n') // Clean up multiple newlines
                    .trim();
                // Support markdown bold
                content = escapeHtml(cleaned).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            }
            
            if (content) {
                const chunkId = chunk.id || '';
                const chunkBox = chunk.grounding?.box || chunk.box || null;
                const pageNumber = typeof chunk.page === 'number' ? chunk.page + 1 : null;
                html += `
                    <div class="markdown-section" data-chunk-id="${chunkId}" data-chunk-type="${sectionType.toLowerCase()}" ${chunkBox ? `data-chunk-box='${JSON.stringify(chunkBox)}'` : ''}>
                        <div class="section-header">
                            <span class="section-type">${numberedLabel}</span>
                            ${pageNumber ? `<span class="section-page">Page ${pageNumber}</span>` : ''}
                        </div>
                        <div class="section-content">
                            ${content}
                        </div>
                    </div>
                `;
            }
        });
    } else {
        // Fallback: Parse markdown string directly
        // Split by anchor tags and process each section
        const sections = markdown.split(/(<a[^>]*>[\s\S]*?<\/a>)/gi);
        
        sections.forEach(section => {
            if (!section.trim()) return;
            
            let sectionType = 'Text';
            let content = '';
            
            // Check if it's an anchor tag (marginalia)
            if (section.match(/^<a[^>]*>/)) {
                sectionType = 'Marginalia';
                // Extract text after anchor
                const textMatch = section.match(/<\/a>\s*(.+)/);
                content = textMatch ? escapeHtml(textMatch[1].trim()) : '';
            } else if (section.includes('<table')) {
                // It's a table
                sectionType = 'Table';
                content = formatTableHTML(section);
            } else {
                // Regular text
                sectionType = 'Text';
                // Remove anchor tags and clean
                const cleaned = section
                    .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '')
                    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') // Bold
                    .trim();
                content = escapeHtml(cleaned);
            }
            
            if (content) {
                // Extract chunk ID from anchor tag if present
                const chunkIdMatch = section.match(/<a[^>]*id=['"]([^'"]+)['"]/i);
                const chunkId = chunkIdMatch ? chunkIdMatch[1] : '';
                
                html += `
                    <div class="markdown-section" data-chunk-id="${chunkId}" data-chunk-type="${sectionType.toLowerCase()}">
                        <div class="section-header">
                            <span class="section-number">${sectionNumber}</span>
                            <span class="section-type">${sectionType}</span>
                        </div>
                        <div class="section-content">
                            ${content}
                        </div>
                    </div>
                `;
                sectionNumber++;
            }
        });
    }
    
    return html || '<p class="doc-meta">No structured content found</p>';
}

// Format table HTML for display - render as actual HTML table
function formatTableHTML(tableHTML, textBeforeTable = '') {
    if (!tableHTML) return '';
    
    // Extract table from HTML string
    const tableMatch = tableHTML.match(/<table[^>]*>[\s\S]*?<\/table>/i);
    if (!tableMatch) {
        return escapeHtml(tableHTML);
    }
    
    const tableString = tableMatch[0];
    
    // Create a temporary container to parse the table
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = tableString;
    
    const table = tempDiv.querySelector('table');
    if (!table) {
        return escapeHtml(tableHTML);
    }
    
    // Add styling classes
    table.className = 'parsed-table';
    
    // Clean up cell IDs (keep structure but remove IDs for cleaner display)
    table.querySelectorAll('td, th').forEach(cell => {
        // Keep the cell content but remove ID attribute for display
        const cellId = cell.getAttribute('id');
        if (cellId) {
            cell.removeAttribute('id');
        }
    });
    
    // Remove table ID for cleaner display
    table.removeAttribute('id');
    
    // Extract title from text before table or from patterns
    let title = '';
    
    // First try to get title from textBeforeTable parameter
    if (textBeforeTable) {
        // Remove anchor tags and clean up
        const cleaned = textBeforeTable.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').trim();
        // Look for patterns like "Student Copy", "Bank Copy", or other titles
        const titleMatch = cleaned.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*(?:Copy|Table|Statement|Report)?)/i);
        if (titleMatch && titleMatch[1].length < 50) {
            title = titleMatch[1].trim();
        } else if (cleaned.length > 0 && cleaned.length < 50 && !cleaned.includes('<')) {
            // Use the cleaned text if it's short and doesn't contain HTML
            title = cleaned;
        }
    }
    
    // If no title found, try patterns in the tableHTML itself
    if (!title) {
        const titlePatterns = [
            /([A-Z][a-z]+\s+Copy)\s*<table/i,
            /([A-Z][^<]+?)\s*<table/i
        ];
        
        for (const pattern of titlePatterns) {
            const titleMatch = tableHTML.match(pattern);
            if (titleMatch) {
                title = titleMatch[1].trim();
                // Remove anchor tags from title
                title = title.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '').trim();
                if (title && title.length < 50) {
                    break;
                }
            }
        }
    }
    
    let result = '';
    if (title) {
        result += `<div class="table-title">${escapeHtml(title)}</div>`;
    }
    // Wrap table in scrollable container for mobile
    result += `<div class="table-wrapper">${table.outerHTML}</div>`;
    
    return result;
}

// Format table data object into HTML table
function formatTableData(table) {
    const header = table.header || [];
    const rows = table.rows || [];
    const title = table.title || '';
    
    let html = '';
    if (title) {
        html += `<div class="table-title">${escapeHtml(title)}</div>`;
    }
    
    html += '<div class="table-wrapper"><table class="parsed-table">';
    
    if (header.length > 0) {
        html += '<thead><tr>';
        header.forEach(col => {
            html += `<th>${escapeHtml(String(col))}</th>`;
        });
        html += '</tr></thead>';
    }
    
    if (rows.length > 0) {
        html += '<tbody>';
        rows.forEach(row => {
            html += '<tr>';
            const columns = header.length > 0 ? header : Object.keys(row);
            columns.forEach(col => {
                const cellValue = row[col] || '';
                html += `<td>${escapeHtml(String(cellValue))}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody>';
    }
    
    html += '</table></div>';
    return html;
}

function formatBoundingBox(box) {
    if (!box) return '';
    if (typeof box.left === 'number' && typeof box.top === 'number' &&
        typeof box.right === 'number' && typeof box.bottom === 'number') {
        const pct = value => `${(value * 100).toFixed(1)}%`;
        return `${pct(box.left)}, ${pct(box.top)} → ${pct(box.right)}, ${pct(box.bottom)}`;
    }
    return '';
}

function renderCitationChips(citations) {
    if (!citations || citations.length === 0) return '';
    return `
        <div class="chat-citations">
            ${citations.map((citation, index) => `
                <button
                    class="citation-chip"
                    data-citation-chunk="${citation.chunk_id || ''}"
                    title="${escapeHtml(citation.title || 'Reference')}"
                >
                    Ref ${index + 1}${typeof citation.page === 'number' ? ` · Pg ${citation.page + 1}` : ''}
                </button>
            `).join('')}
        </div>
    `;
}

function attachCitationHandlers() {
    document.querySelectorAll('.citation-chip').forEach(chip => {
        const chunkId = chip.dataset.citationChunk;
        if (!chunkId) return;
        chip.addEventListener('mouseenter', () => highlightChunk(chunkId));
        chip.addEventListener('mouseleave', () => highlightChunk(null));
        chip.addEventListener('click', () => {
            highlightChunk(chunkId);
            scrollStageIntoView();
        });
    });
}

function renderTablesSection(tables) {
    if (!tables || tables.length === 0) return '';
    return `
        <div class="tables-section">
            <div class="tables-header">
                <h3>Detected Tables</h3>
                <p class="doc-meta">Click a card to jump to the overlay preview.</p>
            </div>
            <div class="table-grid">
                ${tables.map((table, index) => renderTableCard(table, index)).join('')}
            </div>
        </div>
    `;
}

function renderTableCard(table, index) {
    const header = table.header || [];
    const rows = table.rows || [];
    const title = table.title || `Table ${index + 1}`;
    const pageLabel = typeof table.page === 'number' ? `Page ${table.page + 1}` : 'Page n/a';
    let bodyHtml = '';

    if (rows.length > 0 || header.length > 0) {
        // Show ALL rows - no limit, just like Landing.AI
        // Get columns from header or from first row keys
        const columns = header.length > 0 ? header : (rows.length > 0 ? Object.keys(rows[0] || {}) : []);
        
        // Helper to check if a value looks numeric (for right alignment)
        const isNumeric = (val) => {
            if (!val || typeof val !== 'string') return false;
            const cleaned = val.replace(/[,\s$€£¥₹]/g, '');
            return /^-?\d+(\.\d+)?$/.test(cleaned);
        };

        bodyHtml = `
            <div class="table-scroll">
                <table>
                    ${columns.length > 0 ? `
                        <thead>
                            <tr>
                                ${columns.map(col => `<th>${escapeHtml(String(col))}</th>`).join('')}
                            </tr>
                        </thead>
                    ` : ''}
                    <tbody>
                        ${rows.map((row, rowIdx) => {
                            // Get cell values - try column name first, then index, then row keys
                            const cellValues = columns.map((col, colIdx) => {
                                // Try multiple ways to get the cell value
                                let cellValue = row[col] || row[colIdx] || '';
                                // If still empty, try getting by index from row values
                                if (!cellValue && typeof row === 'object') {
                                    const rowValues = Object.values(row);
                                    if (colIdx < rowValues.length) {
                                        cellValue = rowValues[colIdx];
                                    }
                                }
                                return cellValue || '';
                            });
                            
                            return `
                                <tr>
                                    ${cellValues.map((cellValue, colIdx) => {
                                        const cellText = String(cellValue || '');
                                        const alignClass = isNumeric(cellText) ? 'style="text-align: right;"' : '';
                                        return `<td ${alignClass}>${escapeHtml(cellText)}</td>`;
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } else {
        bodyHtml = '<p class="doc-meta">Table detected but no rows or headers were parsed.</p>';
    }

    return `
        <div class="table-card" data-table-chunk="${table.id || ''}">
            <div class="table-card-header">
                <strong>${escapeHtml(title)}</strong>
                <span class="doc-meta">${pageLabel}</span>
            </div>
            ${bodyHtml}
        </div>
    `;
}

function bindTableInteractions(tables) {
    requestAnimationFrame(() => {
        const cards = document.querySelectorAll('[data-table-chunk]');
        cards.forEach(card => {
            const chunkId = card.dataset.tableChunk;
            if (!chunkId) return;
            card.addEventListener('mouseenter', () => highlightChunk(chunkId));
            card.addEventListener('mouseleave', () => highlightChunk(null));
            card.addEventListener('click', () => {
                highlightChunk(chunkId);
                scrollStageIntoView();
            });
        });
    });
}

// Interactive region detection functions
function highlightChunk(chunkId) {
    document.querySelectorAll('.overlay-box').forEach(box => {
        box.classList.toggle('active', Boolean(chunkId) && box.dataset.chunkId === chunkId);
    });
    document.querySelectorAll('[data-table-chunk]').forEach(card => {
        card.classList.toggle('active', Boolean(chunkId) && card.dataset.tableChunk === chunkId);
    });
}

function highlightMarkdownSection(chunkId) {
    // Remove all highlights
    document.querySelectorAll('.markdown-section').forEach(section => {
        section.classList.remove('highlighted');
    });
    
    // Highlight the section with matching chunk ID
    if (chunkId) {
        const section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
        if (section) {
            section.classList.add('highlighted');
        }
    }
}

function scrollToMarkdownSection(chunkId) {
    if (!chunkId) return;
    
    const section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightMarkdownSection(chunkId);
        
        // Remove highlight after 2 seconds
        setTimeout(() => {
            section.classList.remove('highlighted');
        }, 2000);
    }
}

function setupMarkdownInteractivity() {
    // Add click handlers to all markdown sections
    document.querySelectorAll('.markdown-section').forEach(section => {
        const chunkId = section.dataset.chunkId;
        if (!chunkId) return;
        
        section.addEventListener('click', () => {
            // Highlight PDF region
            highlightPdfRegion(chunkId);
            // Scroll to section (already visible, just highlight)
            section.scrollIntoView({ behavior: 'smooth', block: 'center' });
            highlightMarkdownSection(chunkId);
        });
        
        section.addEventListener('mouseenter', () => {
            highlightPdfRegion(chunkId);
        });
        
        section.addEventListener('mouseleave', () => {
            highlightPdfRegion(null);
        });
    });
}

function highlightPdfRegion(chunkId) {
    if (!pdfOverlay) return;
    
    // Remove all highlights
    pdfOverlay.querySelectorAll('.overlay-box').forEach(box => {
        box.classList.remove('highlighted', 'active');
    });
    
    // Highlight the matching region
    if (chunkId) {
        const overlayBox = pdfOverlay.querySelector(`.overlay-box[data-chunk-id="${chunkId}"]`);
        if (overlayBox) {
            overlayBox.classList.add('highlighted', 'active');
        }
    }
}

function scrollStageIntoView() {
    const stage = document.querySelector('.document-stage');
    if (stage) {
        stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

async function renderDocumentPreview(document) {
    if (!pdfWrapper || !window.pdfjsLib) return;
    if (!document || document.status !== 'complete') {
        if (pdfWrapper) pdfWrapper.innerHTML = '';
        if (pageIndicator) pageIndicator.textContent = 'Preview unavailable';
        pdfDocInstance = null;
        currentOverlayChunks = [];
        return;
    }

    const docId = document.document_id || selectedDocumentId;
    if (!docId) return;
    
    // Reset counters for new document
    resetCounters();
    
    const fileUrl = `${API_BASE_URL}/documents/${docId}/file?cache=${Date.now()}`;
    try {
        pdfDocInstance = await window.pdfjsLib.getDocument(fileUrl).promise;
        currentOverlayChunks = document.detected_chunks || [];
        
        // Pre-assign numbers to all chunks for consistent labeling
        if (currentOverlayChunks) {
            currentOverlayChunks.forEach(chunk => {
                const chunkType = (chunk.type || 'text').toLowerCase();
                getNumberedLabel(chunkType, chunk.id || '');
            });
        }
        
        await renderAllPdfPages();
    } catch (error) {
        console.error('Error loading PDF preview:', error);
        if (pageIndicator) {
            pageIndicator.textContent = 'Preview unavailable';
        }
    }
}

// Render all PDF pages stacked vertically
async function renderAllPdfPages() {
    if (!pdfDocInstance || !pdfWrapper) return;
    const totalPages = pdfDocInstance.numPages;
    
    // Clear wrapper
    pdfWrapper.innerHTML = '';
    
    // Update page indicator
    if (pageIndicator) {
        pageIndicator.textContent = `All Pages (${totalPages} total)`;
    }
    
    // Disable navigation buttons since we're showing all pages
    if (pdfPrevButton) pdfPrevButton.style.display = 'none';
    if (pdfNextButton) pdfNextButton.style.display = 'none';
    
    const wrapperWidth = pdfWrapper.clientWidth;
    let totalHeight = 0;
    
    // Render all pages
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const page = await pdfDocInstance.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = wrapperWidth / baseViewport.width;
            const viewport = page.getViewport({ scale });
            
            // Create container for this page
            const pageContainer = document.createElement('div');
            pageContainer.className = 'pdf-page-container';
            pageContainer.style.position = 'relative';
            pageContainer.style.marginBottom = '20px';
            pageContainer.style.width = `${viewport.width}px`;
            pageContainer.style.height = `${viewport.height}px`;
            pageContainer.dataset.pageNumber = pageNum;
            
            // Create canvas for this page
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const context = canvas.getContext('2d');
            
            // Render page
            await page.render({ canvasContext: context, viewport }).promise;
            pageContainer.appendChild(canvas);
            
            // Create overlay for this page
            const overlay = document.createElement('div');
            overlay.className = 'pdf-overlay';
            overlay.style.position = 'absolute';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = `${viewport.width}px`;
            overlay.style.height = `${viewport.height}px`;
            overlay.style.pointerEvents = 'none';
            pageContainer.appendChild(overlay);
            
            // Draw overlays for this page
            drawPageOverlays(overlay, viewport, pageNum);
            
            pdfWrapper.appendChild(pageContainer);
            totalHeight += viewport.height + 20; // Add margin
        } catch (error) {
            console.error(`Error rendering PDF page ${pageNum}:`, error);
        }
    }
}

// Legacy single page render (kept for compatibility)
async function renderPdfPage(pageNumber) {
    if (!pdfDocInstance || !pdfContext) return;
    const totalPages = pdfDocInstance.numPages;
    currentPdfPage = Math.min(Math.max(pageNumber, 1), totalPages);

    if (pdfPrevButton) pdfPrevButton.disabled = currentPdfPage <= 1;
    if (pdfNextButton) pdfNextButton.disabled = currentPdfPage >= totalPages;

    try {
        const page = await pdfDocInstance.getPage(currentPdfPage);
        const baseViewport = page.getViewport({ scale: 1 });
        const wrapperWidth = pdfWrapper ? pdfWrapper.clientWidth : baseViewport.width;
        const scale = wrapperWidth / baseViewport.width;
        const viewport = page.getViewport({ scale });

        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        await page.render({ canvasContext: pdfContext, viewport }).promise;
        drawOverlays(viewport);

        if (pageIndicator) {
            pageIndicator.textContent = `Page ${currentPdfPage} / ${totalPages}`;
        }
    } catch (error) {
        console.error('Error rendering PDF page:', error);
    }
}

// Draw overlays for a specific page
function drawPageOverlays(overlayElement, viewport, pageNumber) {
    if (!overlayElement) return;
    overlayElement.innerHTML = '';
    const overlays = (currentOverlayChunks || []).filter(chunk => {
        if (typeof chunk.page !== 'number') return true;
        return chunk.page + 1 === pageNumber;
    });

    overlays.forEach(chunk => {
        if (!chunk.box) return;
        const box = chunk.box;
        const overlayBox = document.createElement('div');
        overlayBox.className = 'overlay-box';
        overlayBox.style.position = 'absolute';
        overlayBox.style.left = `${box.left * viewport.width}px`;
        overlayBox.style.top = `${box.top * viewport.height}px`;
        overlayBox.style.width = `${(box.right - box.left) * viewport.width}px`;
        overlayBox.style.height = `${(box.bottom - box.top) * viewport.height}px`;
        overlayBox.dataset.chunkId = chunk.id || '';
        overlayBox.style.pointerEvents = 'auto';
        overlayBox.style.cursor = 'pointer';

        const label = document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        // Get numbered label based on type
        const numberedLabel = getNumberedLabel(chunkType, chunk.id || '');
        label.textContent = numberedLabel;
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            highlightChunk(chunk.id || '');
            highlightMarkdownSection(chunk.id || '');
        });
        overlayBox.addEventListener('mouseleave', () => {
            highlightChunk(null);
            highlightMarkdownSection(null);
        });
        overlayBox.addEventListener('click', () => {
            scrollToMarkdownSection(chunk.id || '');
        });

        overlayElement.appendChild(overlayBox);
    });
}

// Legacy overlay function (kept for compatibility)
function drawOverlays(viewport) {
    if (!pdfOverlay) return;
    pdfOverlay.style.width = `${viewport.width}px`;
    pdfOverlay.style.height = `${viewport.height}px`;
    pdfOverlay.innerHTML = '';
    const overlays = (currentOverlayChunks || []).filter(chunk => {
        if (typeof chunk.page !== 'number') return true;
        return chunk.page + 1 === currentPdfPage;
    });

    overlays.forEach(chunk => {
        if (!chunk.box) return;
        const box = chunk.box;
        const overlayBox = document.createElement('div');
        overlayBox.className = 'overlay-box';
        overlayBox.style.left = `${box.left * viewport.width}px`;
        overlayBox.style.top = `${box.top * viewport.height}px`;
        overlayBox.style.width = `${(box.right - box.left) * viewport.width}px`;
        overlayBox.style.height = `${(box.bottom - box.top) * viewport.height}px`;
        overlayBox.dataset.chunkId = chunk.id || '';

        const label = document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        const numberedLabel = getNumberedLabel(chunkType, chunk.id || '');
        label.textContent = numberedLabel;
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            highlightChunk(chunk.id || '');
            highlightMarkdownSection(chunk.id || '');
        });
        overlayBox.addEventListener('mouseleave', () => {
            highlightChunk(null);
            highlightMarkdownSection(null);
        });
        overlayBox.addEventListener('click', () => {
            scrollToMarkdownSection(chunk.id || '');
        });

        pdfOverlay.appendChild(overlayBox);
    });
}

// Counters for numbered labels
let tableCounter = 0;
let textCounter = 0;
let chartCounter = 0;
let marginaliaCounter = 0;
const chunkIdToNumber = new Map();

// Get numbered label for a chunk
function getNumberedLabel(chunkType, chunkId) {
    if (!chunkId) return chunkType.toUpperCase();
    
    // Check if we already assigned a number to this chunk
    if (chunkIdToNumber.has(chunkId)) {
        const number = chunkIdToNumber.get(chunkId);
        const type = chunkIdToNumber.get(chunkId + '_type');
        return `${type} ${number}`;
    }
    
    // Assign new number based on type
    let label = '';
    let number = 0;
    if (chunkType === 'table') {
        tableCounter++;
        number = tableCounter;
        label = `Table ${number}`;
    } else if (chunkType === 'chart' || chunkType === 'graph') {
        chartCounter++;
        number = chartCounter;
        label = `Chart ${number}`;
    } else if (chunkType === 'marginalia') {
        marginaliaCounter++;
        number = marginaliaCounter;
        label = `Marginalia ${number}`;
    } else {
        textCounter++;
        number = textCounter;
        label = `Text ${number}`;
    }
    
    // Store the mapping
    chunkIdToNumber.set(chunkId, number);
    chunkIdToNumber.set(chunkId + '_type', label.split(' ')[0]);
    
    return label;
}

// Reset counters when new document is loaded
function resetCounters() {
    tableCounter = 0;
    textCounter = 0;
    chartCounter = 0;
    marginaliaCounter = 0;
    chunkIdToNumber.clear();
}

function navigatePdf(delta) {
    if (!pdfDocInstance) return;
    renderPdfPage(currentPdfPage + delta);
}

// Function to send a chat message
async function sendChatMessage() {
    const query = chatInput.value.trim();
    
    if (!query) {
        return;
    }
    
    if (!selectedDocumentId) {
        chatMessages.innerHTML += `
            <div class="message response">
                Please select a document first.
            </div>
        `;
        return;
    }
    
    // Add user query to chat
    chatMessages.innerHTML += `
        <div class="message query">
            <strong>You:</strong> ${query}
        </div>
    `;
    
    // Clear input
    chatInput.value = '';
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    try {
        const response = await fetch(`${API_BASE_URL}/documents/chat`, {
            method: 'POST',
            credentials: 'include',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                document_id: selectedDocumentId,
                query: query,
            }),
        });
        
        // Handle 401 - redirect to login
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.detail || 'Failed to get answer');
        }
        
        const data = await response.json();
        
        // Determine source class
        let sourceClass = '';
        let sourceText = '';
        
        if (data.source) {
            if (data.source === 'landing_ai') {
                sourceClass = 'source-landing-ai';
                sourceText = 'Landing.AI';
            } else if (data.source === 'local_llm') {
                sourceClass = 'source-local-llm';
                sourceText = 'Local LLM';
            }
        }
        
        const citationHtml = renderCitationChips(data.sources);
        chatMessages.innerHTML += `
            <div class="message response">
                <strong>ALPHA LENS:</strong> 
                ${escapeHtml(data.answer)}
                ${sourceText ? `<span class="source-tag ${sourceClass}">${sourceText}</span>` : ''}
                ${citationHtml}
            </div>
        `;
        attachCitationHandlers();
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error getting answer:', error);
        
        chatMessages.innerHTML += `
            <div class="message response">
                <strong>ALPHA LENS:</strong> Error getting answer: ${error.message}
            </div>
        `;
        
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

