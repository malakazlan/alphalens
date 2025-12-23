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
        if (analyzerSection) {
            analyzerSection.style.display = 'block';
            // Show initial state by default
            showAnalyzerInitialState();
        }
        updateNavLinks('analyzer');
        // Initialize analyzer functionality
        initializeAnalyzer();
    } else if (feature === 'finbot') {
        if (finbotSection) finbotSection.style.display = 'block';
        updateNavLinks('chatbot');
    } else if (feature === 'reports') {
        if (reportsSection) {
            reportsSection.style.display = 'block';
            // Load and render reports when section is shown
            if (typeof loadReports === 'function') {
                loadReports();
            } else {
                // Fallback: load reports after a short delay to ensure module is loaded
                setTimeout(() => {
                    if (typeof loadReports === 'function') {
                        loadReports();
                    }
                }, 100);
            }
        }
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
    initializeSidebar();
    initializeResizer();
});

// Sidebar toggle functionality
function initializeSidebar() {
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const resultState = document.getElementById('analyzer-result-state');
    const dashboard = resultState ? resultState.querySelector('.dashboard') : null;
    const sidebar = document.getElementById('workspace-sidebar');
    
    if (!sidebarToggle || !sidebarCloseBtn || !dashboard || !sidebar) {
        console.warn('Sidebar elements not found');
        return;
    }
    
    // Load saved sidebar state from localStorage
    // Default to open (visible) unless explicitly saved as collapsed
    const savedState = localStorage.getItem('sidebar-collapsed');
    if (savedState === 'true') {
        dashboard.classList.add('sidebar-collapsed');
    } else {
        // Ensure sidebar is visible by default
        dashboard.classList.remove('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', 'false');
    }
    
    // Open sidebar
    function openSidebar() {
        dashboard.classList.remove('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', 'false');
        updateSidebarToggleVisibility();
    }
    
    // Close sidebar
    function closeSidebar() {
        dashboard.classList.add('sidebar-collapsed');
        localStorage.setItem('sidebar-collapsed', 'true');
        updateSidebarToggleVisibility();
    }
    
    sidebarToggle.addEventListener('click', openSidebar);
    sidebarCloseBtn.addEventListener('click', closeSidebar);
    
    // Update toggle button visibility
    updateSidebarToggleVisibility();
}

// Function to update sidebar toggle button visibility
function updateSidebarToggleVisibility() {
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const resultState = document.getElementById('analyzer-result-state');
    const dashboard = resultState ? resultState.querySelector('.dashboard') : null;
    
    if (!sidebarToggle || !dashboard) return;
    
    if (dashboard.classList.contains('sidebar-collapsed')) {
        sidebarToggle.style.display = 'flex';
    } else {
        sidebarToggle.style.display = 'none';
    }
}

// Resizer functionality for main content panels (Landing.AI style)
function initializeResizer() {
    const resizer = document.getElementById('resizer-handle');
    const leftPanel = document.querySelector('.document-viewer-section');
    const rightPanel = document.querySelector('.parse-panel-section');
    const container = document.querySelector('.main-content-area');
    
    if (!resizer || !leftPanel || !rightPanel || !container) return;
    
    let isResizing = false;
    let startX = 0;
    let startLeftWidth = 0;
    
    // Set initial widths - 50/50 split
    const containerWidth = container.offsetWidth || container.clientWidth;
    const initialLeftWidth = containerWidth / 2;
    leftPanel.style.flex = `0 0 ${initialLeftWidth}px`;
    rightPanel.style.flex = '1 1 auto';
    
    // Load saved width from localStorage
    const savedLeftWidth = localStorage.getItem('left-panel-width');
    if (savedLeftWidth) {
        const width = parseFloat(savedLeftWidth);
        if (width > 0 && width < containerWidth - 250) {
            leftPanel.style.flex = `0 0 ${width}px`;
            rightPanel.style.flex = '1 1 auto';
        }
    }
    
    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startLeftWidth = leftPanel.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        resizer.style.background = 'rgba(5, 150, 105, 0.3)';
        e.preventDefault();
        e.stopPropagation();
    });
    
    const handleMouseMove = (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const containerWidth = container.offsetWidth;
        const resizerWidth = resizer.offsetWidth;
        
        // Calculate new left panel width
        let newLeftWidth = startLeftWidth + deltaX;
        
        // Minimum and maximum widths
        const minWidth = 250;
        const maxWidth = containerWidth - 250 - resizerWidth;
        
        // Clamp the width
        newLeftWidth = Math.max(minWidth, Math.min(maxWidth, newLeftWidth));
        
        // Apply new width - left panel gets fixed width, right panel flexes
        leftPanel.style.flex = `0 0 ${newLeftWidth}px`;
        rightPanel.style.flex = '1 1 auto';
        rightPanel.style.minWidth = '250px';
        
        // Save to localStorage
        localStorage.setItem('left-panel-width', newLeftWidth.toString());
        
        // Trigger resize to redraw PDF/image
        handlePanelResize();
    };
    
    // Function to handle panel resize and redraw content
    function handlePanelResize() {
        // Use requestAnimationFrame to debounce resize
        if (handlePanelResize.timeout) {
            cancelAnimationFrame(handlePanelResize.timeout);
        }
        handlePanelResize.timeout = requestAnimationFrame(() => {
            // Redraw PDF if it exists
            if (pdfDocInstance) {
                // Check if we're using multi-page view
                const pageContainers = pdfWrapper?.querySelectorAll('.pdf-page-container');
                if (pageContainers && pageContainers.length > 0) {
                    // Multi-page view - redraw all pages
                    renderAllPdfPages();
                } else if (currentPdfPage) {
                    // Single page view - redraw current page
                    renderPdfPage(currentPdfPage);
                }
            }
            
            // Redraw image if it exists
            const imageContainer = pdfWrapper?.querySelector('.image-container');
            if (imageContainer) {
                const img = imageContainer.querySelector('img');
                if (img && img.complete) {
                    // Recalculate and redraw image overlays
                    const chunks = currentOverlayChunks || [];
                    if (chunks.length > 0) {
                        // Remove existing overlay
                        const existingOverlay = imageContainer.querySelector('.image-overlay');
                        if (existingOverlay) {
                            existingOverlay.remove();
                        }
                        // Redraw overlays with new dimensions
                        drawImageOverlays(img, chunks);
                    }
                }
            }
        });
    }
    
    const handleMouseUp = () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            resizer.style.background = 'transparent';
        }
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Also handle mouse leave to stop resizing
    document.addEventListener('mouseleave', handleMouseUp);
    
    // Add ResizeObserver to watch for panel size changes
    if (window.ResizeObserver) {
        const resizeObserver = new ResizeObserver((entries) => {
            // Debounce resize events
            if (resizeObserver.timeout) {
                clearTimeout(resizeObserver.timeout);
            }
            resizeObserver.timeout = setTimeout(() => {
                handlePanelResize();
            }, 150);
        });
        
        // Observe both panels
        resizeObserver.observe(leftPanel);
        resizeObserver.observe(rightPanel);
    }
}

// Analyzer State Management
let currentAnalyzerState = 'initial'; // 'initial', 'loading', 'result'

function showAnalyzerInitialState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    const analyzerContainer = document.getElementById('analyzer-section');
    const pageContainer = document.querySelector('.page');
    
    if (initialState) initialState.style.display = 'block';
    if (loadingState) loadingState.style.display = 'none';
    if (resultState) resultState.style.display = 'none';
    
    // Remove classes to restore padding
    if (analyzerContainer) analyzerContainer.classList.remove('result-state-active');
    if (pageContainer) pageContainer.classList.remove('analyzer-result-active');
    
    currentAnalyzerState = 'initial';
}

function showAnalyzerLoadingState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    
    if (initialState) initialState.style.display = 'none';
    if (loadingState) loadingState.style.display = 'flex';
    if (resultState) resultState.style.display = 'none';
    
    currentAnalyzerState = 'loading';
}

function showAnalyzerResultState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    const analyzerContainer = document.getElementById('analyzer-section');
    const pageContainer = document.querySelector('.page');
    
    if (initialState) initialState.style.display = 'none';
    if (loadingState) loadingState.style.display = 'none';
    if (resultState) resultState.style.display = 'block';
    
    // Add classes to remove padding
    if (analyzerContainer) analyzerContainer.classList.add('result-state-active');
    if (pageContainer) pageContainer.classList.add('analyzer-result-active');
    
    currentAnalyzerState = 'result';
    
    // Initialize sidebar and resizer when result state is shown
    setTimeout(() => {
        initializeSidebar();
        initializeResizer();
        
        // Force sidebar to be visible
        const dashboard = resultState.querySelector('.dashboard');
        const sidebar = document.getElementById('workspace-sidebar');
        if (dashboard && sidebar) {
            // Remove collapsed class if it exists
            dashboard.classList.remove('sidebar-collapsed');
            // Force visibility with inline styles
            sidebar.style.display = 'flex';
            sidebar.style.visibility = 'visible';
            sidebar.style.opacity = '1';
            sidebar.style.transform = 'translateX(0)';
            sidebar.style.minWidth = '260px';
            sidebar.style.maxWidth = '260px';
            sidebar.style.width = '260px';
            // Ensure it's in the grid
            sidebar.style.gridColumn = '1';
            sidebar.style.position = 'relative';
        }
    }, 100);
}

function initializeAnalyzer() {
    // Set up action card upload buttons
    const uploadButtons = document.querySelectorAll('.action-card-upload-btn');
    uploadButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.getAttribute('data-action');
            handleActionCardUpload(action);
        });
    });
    
    // Set up back button
    const backBtn = document.getElementById('back-to-cards-btn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showAnalyzerInitialState();
        });
    }
    
    // Load pre-saved documents
    loadPresavedDocuments();
}

function handleActionCardUpload(action) {
    // Use the hidden file input
    const fileInput = document.getElementById('action-card-file-input');
    if (!fileInput) return;
    
    // Reset the input
    fileInput.value = '';
    
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            showAnalyzerLoadingState();
            await processFileUpload(file, action);
        }
    }, { once: true });
    
    fileInput.click();
}

async function processFileUpload(file, action) {
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        // Get auth headers but remove Content-Type for FormData (browser sets it automatically)
        const authHeaders = getAuthHeaders();
        delete authHeaders['Content-Type'];
        
        const response = await fetch(`${API_BASE_URL}/documents/upload`, {
            method: 'POST',
            credentials: 'include',
            headers: authHeaders,
            body: formData
        });
        
        // Handle 401 - redirect to login
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (!response.ok) {
            let errorMessage = `Upload failed: ${response.statusText}`;
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.error || errorMessage;
            } catch (e) {
                // If response is not JSON, use status text
                errorMessage = `Upload failed: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        if (!data.document_id) {
            throw new Error('No document ID returned from server');
        }
        
        // Wait for processing to complete
        await waitForProcessing(data.document_id);
        
        // Load the document
        await selectDocument(data.document_id);
        
        // Show result state
        showAnalyzerResultState();
        
        // Switch to appropriate tab based on action
        if (action === 'extract') {
            const extractTab = document.querySelector('[data-tab="extract"]');
            if (extractTab) extractTab.click();
        } else if (action === 'chat') {
            const chatTab = document.querySelector('[data-tab="chat"]');
            if (chatTab) chatTab.click();
        }
        
    } catch (error) {
        console.error('Upload error:', error);
        showAnalyzerInitialState();
        
        // Show more detailed error message
        let errorMessage = 'Failed to upload document.';
        if (error.message) {
            errorMessage = error.message;
        }
        
        // Check if it's a network error
        if (error.message && error.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        alert(errorMessage);
    }
}

async function waitForProcessing(documentId) {
    const maxAttempts = 60; // 60 seconds max
    let attempts = 0;
    
    while (attempts < maxAttempts) {
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
            
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'complete') {
                    return;
                }
            }
        } catch (error) {
            console.error('Error checking status:', error);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }
    
    throw new Error('Processing timeout - document is still being processed');
}

function loadPresavedDocuments() {
    // Load documents from API and populate the pre-saved docs list
    loadDocuments().then(() => {
        // updatePresavedDocuments will be called from displayDocuments
    });
}

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

// Upload icon button - opens file input or scrolls to document list
const fileSelectBtn = document.getElementById('file-select-btn');
if (fileSelectBtn) {
    fileSelectBtn.addEventListener('click', () => {
        const fileInput = document.getElementById('file-input');
        if (fileInput) {
            fileInput.click();
        } else {
            // If file input not found, scroll to document list in sidebar
            const documentList = document.getElementById('document-list');
            if (documentList) {
                documentList.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    });
}

// Tab switching functionality - Top level tabs (Parse, Extract, Chat)
document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        
        // Update active tab
        document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        
        // Show/hide content - use tab-content-wrapper
        document.querySelectorAll('.tab-content-wrapper').forEach(content => {
            content.style.display = 'none';
        });
        const activeContent = document.getElementById(`${tabName}-tab-content`);
        if (activeContent) {
            activeContent.style.display = 'flex';
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

// Helper function to deduplicate documents by filename (keep most recent)
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
        // Clear pre-saved documents
        updatePresavedDocuments([]);
        return;
    }
    
    // Deduplicate documents by filename
    const uniqueDocuments = deduplicateDocuments(documents);
    
    documentList.innerHTML = '';
    // Only update hero-doc-count if it exists (homepage only)
    const heroDocCount = document.getElementById('hero-doc-count');
    if (heroDocCount) {
        heroDocCount.textContent = uniqueDocuments.length;
    }
    
    uniqueDocuments.forEach(doc => {
        const listItem = document.createElement('li');
        listItem.className = 'document-item';
        listItem.dataset.id = doc.document_id;
        listItem.setAttribute('data-document-id', doc.document_id);
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
    
    // Update pre-saved documents list
    updatePresavedDocuments(documents);
}

// Function to update pre-saved documents section
function updatePresavedDocuments(documents) {
    const presavedList = document.getElementById('presaved-docs-list');
    if (!presavedList) return;
    
    presavedList.innerHTML = '';
    
    if (documents.length === 0) {
        presavedList.innerHTML = '<p class="doc-meta" style="padding: 12px; color: var(--text-secondary);">No documents yet</p>';
        return;
    }
    
    // Deduplicate documents by filename (keep most recent)
    const uniqueDocuments = deduplicateDocuments(documents);
    
    uniqueDocuments.forEach(doc => {
        const presavedItem = document.createElement('div');
        presavedItem.className = 'presaved-doc-item';
        presavedItem.innerHTML = `
            <h4 class="presaved-doc-name">${doc.filename || doc.document_id}</h4>
            <p class="presaved-doc-meta">${doc.status === 'complete' ? 'Ready' : 'Processing...'}</p>
        `;
        presavedItem.addEventListener('click', async () => {
            showAnalyzerLoadingState();
            try {
                await selectDocument(doc.document_id);
                showAnalyzerResultState();
            } catch (error) {
                console.error('Error loading document:', error);
                showAnalyzerInitialState();
                alert('Failed to load document. Please try again.');
            }
        });
        presavedList.appendChild(presavedItem);
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
    
    // If we're in initial state, show loading first
    if (currentAnalyzerState === 'initial') {
        showAnalyzerLoadingState();
    }
    
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
        
        // Clear chat messages and show example prompts
        if (chatMessages) {
            chatMessages.innerHTML = '';
            chatMessages.style.display = 'none';
        }
        updateExamplePrompts(document);
        
        // Transition to result state if we're in loading state
        if (currentAnalyzerState === 'loading') {
            showAnalyzerResultState();
        }
    } catch (error) {
        console.error('Error loading document details:', error);
        documentView.innerHTML = `<div class="status-banner error">Error loading document details: ${error.message}</div>`;
        
        // If error occurred during loading, go back to initial state
        if (currentAnalyzerState === 'loading') {
            showAnalyzerInitialState();
        }
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
    
    // Update document name in header bar
    const selectedFileElement = document.getElementById('selected-file-name');
    if (selectedFileElement) {
        if (docData.filename) {
            selectedFileElement.textContent = docData.filename;
        } else {
            selectedFileElement.textContent = 'No document selected';
        }
    }
    
    // Load PDF if available
    if (docData.status === 'complete' && pdfWrapper) {
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

// Convert markdown to HTML for chat messages (ChatGPT-like formatting)
function renderMarkdown(text) {
    if (!text) return '';
    
    let html = text;
    
    // Code blocks first (before escaping, to preserve code)
    html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
        const escapedCode = escapeHtml(code.trim());
        return `<pre><code>${escapedCode}</code></pre>`;
    });
    
    // Escape HTML to prevent XSS (but preserve code blocks)
    const codeBlockPlaceholders = [];
    html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlockPlaceholders.length}__`;
        codeBlockPlaceholders.push(code);
        return placeholder;
    });
    
    html = escapeHtml(html);
    
    // Restore code blocks
    codeBlockPlaceholders.forEach((code, idx) => {
        html = html.replace(`__CODE_BLOCK_${idx}__`, `<pre><code>${code}</code></pre>`);
    });
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Inline code (single backticks) - but not inside code blocks
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    
    // Bold (**text**)
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Italic (*text*) - but not if it's part of **text**
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    
    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    
    // Blockquotes (> text)
    html = html.replace(/^> (.+)$/gim, '<blockquote>$1</blockquote>');
    
    // Horizontal rules
    html = html.replace(/^---$/gim, '<hr>');
    
    // Process lists - split by lines first
    const lines = html.split('\n');
    const processedLines = [];
    let inList = false;
    let listType = null; // 'ul' or 'ol'
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match bullet points: - or * followed by space
        const unorderedMatch = line.match(/^[\*\-]\s+(.+)$/);
        // Match ordered lists: number. followed by space
        const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
        
        if (unorderedMatch || orderedMatch) {
            const itemText = unorderedMatch ? unorderedMatch[1] : orderedMatch[1];
            const currentListType = unorderedMatch ? 'ul' : 'ol';
            
            if (!inList || listType !== currentListType) {
                // Close previous list if exists
                if (inList) {
                    processedLines.push(`</${listType}>`);
                }
                // Start new list
                processedLines.push(`<${currentListType}>`);
                inList = true;
                listType = currentListType;
            }
            // Process markdown within list items (bold, italic, etc.)
            let itemHtml = itemText;
            itemHtml = itemHtml.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            itemHtml = itemHtml.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
            itemHtml = itemHtml.replace(/`([^`\n]+)`/g, '<code>$1</code>');
            processedLines.push(`<li>${itemHtml}</li>`);
        } else {
            // Close list if we were in one
            if (inList) {
                processedLines.push(`</${listType}>`);
                inList = false;
                listType = null;
            }
            // Only add non-empty lines
            if (line.trim()) {
                processedLines.push(line);
            }
        }
    }
    
    // Close list if still open
    if (inList) {
        processedLines.push(`</${listType}>`);
    }
    
    html = processedLines.join('\n');
    
    // Paragraphs (double newlines) - but preserve block elements
    html = html.split(/\n\n+/).map(para => {
        para = para.trim();
        if (!para) return '';
        // Don't wrap if it's already a block element
        if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|p)/.test(para)) {
            return para;
        }
        return `<p>${para}</p>`;
    }).join('\n');
    
    // Single newlines within paragraphs become <br>
    html = html.replace(/(<p>[\s\S]*?)<\/p>/g, (match, content) => {
        return content.replace(/\n/g, '<br>') + '</p>';
    });
    
    return html;
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
        docData.detected_chunks.forEach((chunk, index) => {
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
                // Ensure chunkId is a string and not empty - use a fallback if needed
                let chunkId = chunk.id || chunk.chunk_id || '';
                if (!chunkId && chunk.grounding && chunk.grounding.id) {
                    chunkId = chunk.grounding.id;
                }
                // If still no ID, generate one based on index and type
                if (!chunkId) {
                    chunkId = `chunk-${sectionType.toLowerCase()}-${index}`;
                }
                
                const chunkBox = chunk.grounding?.box || chunk.box || null;
                const pageNumber = typeof chunk.page === 'number' ? chunk.page + 1 : null;
                html += `
                    <div class="markdown-section" data-chunk-id="${escapeHtml(String(chunkId))}" data-chunk-type="${sectionType.toLowerCase()}" ${chunkBox ? `data-chunk-box='${JSON.stringify(chunkBox)}'` : ''}>
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
    
    // Group citations by visual reference to show duplicates
    const grouped = {};
    citations.forEach(citation => {
        const key = citation.visual_ref || `${citation.page || 1}. ${citation.type || 'text'}`;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(citation);
    });
    
    const citationItems = Object.entries(grouped).map(([visualRef, refs]) => {
        const citation = refs[0]; // Use first citation for data
        return `
            <button
                class="visual-reference-item"
                data-citation-chunk="${citation.chunk_id || ''}"
                data-page="${citation.page !== undefined ? citation.page : ''}"
                title="${escapeHtml(citation.title || 'Reference')}"
            >
                ${escapeHtml(visualRef)} →
            </button>
        `;
    }).join('');
    
    return `
        <div class="visual-references-section">
            <div class="visual-references-title">Visual reference for the answer:</div>
            <div class="visual-references-list">
                ${citationItems}
                <button class="clear-references-btn" onclick="clearVisualReferences()">Clear</button>
            </div>
        </div>
    `;
}

function attachCitationHandlers() {
    document.querySelectorAll('.visual-reference-item').forEach(item => {
        const chunkId = item.dataset.citationChunk;
        if (!chunkId) return;
        
        item.addEventListener('mouseenter', () => {
            highlightChunk(chunkId);
            highlightPdfRegion(chunkId);
        });
        
        item.addEventListener('mouseleave', () => {
            highlightChunk(null);
            highlightPdfRegion(null);
        });
        
        item.addEventListener('click', () => {
            // Toggle active state
            document.querySelectorAll('.visual-reference-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            
            highlightChunk(chunkId);
            highlightPdfRegion(chunkId);
            scrollToMarkdownSection(chunkId);
            // Scroll PDF to the relevant page if available
            const page = item.dataset.page;
            if (page !== undefined && page !== '') {
                const pageNum = parseInt(page) + 1; // Convert to 1-based
                if (pdfDocInstance && pageNum <= pdfDocInstance.numPages) {
                    renderAllPdfPages(); // Re-render to show the page
                }
            }
        });
    });
}

function clearVisualReferences() {
    // Remove all highlights
    highlightChunk(null);
    highlightPdfRegion(null);
    
    // Remove active state from all visual reference items
    document.querySelectorAll('.visual-reference-item').forEach(item => {
        item.classList.remove('active');
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
    if (!chunkId) {
        console.warn('scrollToMarkdownSection: No chunkId provided');
        return;
    }
    
    console.log('scrollToMarkdownSection: Looking for chunkId:', chunkId);
    
    // First, make sure we're on the Parse tab (not Extract or Chat)
    const parseTab = document.querySelector('.main-tab[data-tab="parse"]');
    const parseTabContent = document.getElementById('parse-tab-content');
    
    if (parseTab && !parseTab.classList.contains('active')) {
        // Switch to Parse tab
        console.log('scrollToMarkdownSection: Switching to Parse tab');
        parseTab.click();
        // Wait for tab switch to complete
        setTimeout(() => {
            scrollToMarkdownSection(chunkId);
        }, 100);
        return;
    }
    
    // Get the parse-content container (right side panel)
    const parseContent = document.getElementById('parse-content');
    if (!parseContent) {
        console.error('scrollToMarkdownSection: parse-content container not found');
        return;
    }
    
    // Make sure we're viewing markdown (not JSON)
    const markdownView = document.getElementById('markdown-view');
    const jsonView = document.getElementById('json-view');
    
    if (!markdownView) {
        console.error('scrollToMarkdownSection: markdown-view not found');
        return;
    }
    
    const needsViewSwitch = markdownView.style.display === 'none' || 
                            (jsonView && jsonView.style.display !== 'none');
    
    if (needsViewSwitch) {
        console.log('scrollToMarkdownSection: Switching to markdown view');
        // Switch to markdown view
        markdownView.style.display = 'block';
        if (jsonView) jsonView.style.display = 'none';
        // Update active tab
        document.querySelectorAll('.parse-view-tab').forEach(tab => {
            tab.classList.remove('active');
            if (tab.dataset.view === 'markdown') {
                tab.classList.add('active');
            }
        });
    }
    
    // Function to perform the scroll
    const performScroll = () => {
        // Find the markdown section - try multiple selectors
        let section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
        
        // If not found, try finding by exact match or partial match
        if (!section) {
            // Try to find all sections and match by chunk ID
            const allSections = document.querySelectorAll('.markdown-section');
            console.log('scrollToMarkdownSection: Found', allSections.length, 'markdown sections');
            
            for (let s of allSections) {
                const sectionChunkId = s.getAttribute('data-chunk-id');
                console.log('scrollToMarkdownSection: Checking section with chunkId:', sectionChunkId);
                if (sectionChunkId === chunkId || sectionChunkId === String(chunkId)) {
                    section = s;
                    break;
                }
            }
        }
        
        if (!section) {
            console.warn('scrollToMarkdownSection: Section not found for chunkId:', chunkId);
            // Try to find any section as fallback
            const firstSection = document.querySelector('.markdown-section');
            if (firstSection) {
                console.log('scrollToMarkdownSection: Scrolling to first section as fallback');
                section = firstSection;
            } else {
                console.error('scrollToMarkdownSection: No markdown sections found at all');
                return;
            }
        }
        
        console.log('scrollToMarkdownSection: Found section, scrolling to it');
        
        // Calculate position relative to parse-content container
        // Get the section's offset position within the markdown-view
        const markdownView = document.getElementById('markdown-view');
        if (!markdownView) {
            console.error('scrollToMarkdownSection: markdown-view not found');
            return;
        }
        
        // Get the section's position relative to markdown-view
        // Use getBoundingClientRect for accurate positioning
        const sectionRect = section.getBoundingClientRect();
        const containerRect = parseContent.getBoundingClientRect();
        const sectionOffsetTop = sectionRect.top - containerRect.top + parseContent.scrollTop;
        const markdownViewOffsetTop = markdownView.offsetTop || 0;
        const sectionRelativeTop = sectionOffsetTop - markdownViewOffsetTop;
        
        // Get current scroll position of parse-content
        const currentScroll = parseContent.scrollTop;
        
        // Calculate target scroll position to center the section
        const containerHeight = parseContent.clientHeight;
        const sectionHeight = section.offsetHeight || section.getBoundingClientRect().height;
        
        // Target scroll: position section in center of viewport
        const targetScroll = sectionRelativeTop - (containerHeight / 2) + (sectionHeight / 2);
        
        // Clamp to valid scroll range
        const maxScroll = Math.max(0, parseContent.scrollHeight - parseContent.clientHeight);
        const finalScroll = Math.max(0, Math.min(targetScroll, maxScroll));
        
        console.log('scrollToMarkdownSection: Scrolling to position:', finalScroll, {
            sectionOffsetTop,
            sectionRelativeTop,
            containerHeight,
            sectionHeight,
            maxScroll
        });
        
        // Scroll ONLY the right panel (parse-content), NOT the whole page
        // Ensure we're scrolling the correct container (parse-content, not the page)
        const scrollContainer = parseContent;
        if (scrollContainer) {
            scrollContainer.scrollTo({
                top: finalScroll,
                behavior: 'smooth'
            });
            
            // Also ensure the section is visible by scrolling it into view within the container
            // Use a small delay to ensure the container is ready
            setTimeout(() => {
                try {
                    section.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center',
                        inline: 'nearest'
                    });
                } catch (e) {
                    // Fallback if scrollIntoView fails
                    console.warn('scrollIntoView failed, using scrollTo only');
                }
            }, 50);
        }
        
        // Highlight the section
        highlightMarkdownSection(chunkId);
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
            const section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
            if (section) {
                section.classList.remove('highlighted');
            }
        }, 3000);
    };
    
    // If we switched views or tabs, wait a bit for DOM to update, otherwise scroll immediately
    if (needsViewSwitch) {
        setTimeout(performScroll, 100);
    } else {
        // Small delay to ensure DOM is ready
        setTimeout(performScroll, 50);
    }
}

function setupMarkdownInteractivity() {
    // Add click handlers to all markdown sections
    document.querySelectorAll('.markdown-section').forEach(section => {
        const chunkId = section.dataset.chunkId;
        if (!chunkId) return;
        
        section.addEventListener('click', () => {
            // Highlight PDF region (left side - no scrolling)
            highlightPdfRegion(chunkId);
            // Highlight markdown section
            highlightMarkdownSection(chunkId);
            // Scroll within parse-content container only (right side)
            scrollToMarkdownSection(chunkId);
        });
        
        section.addEventListener('mouseenter', () => {
            highlightPdfRegion(chunkId);
            highlightMarkdownSection(chunkId);
        });
        
        section.addEventListener('mouseleave', () => {
            highlightPdfRegion(null);
            highlightMarkdownSection(null);
        });
    });
}

function highlightPdfRegion(chunkId) {
    // Find all overlay boxes in all page containers (for multi-page view)
    const allOverlayBoxes = document.querySelectorAll('.pdf-overlay .overlay-box');
    
    // Remove all highlights
    allOverlayBoxes.forEach(box => {
        box.classList.remove('highlighted', 'active');
    });
    
    // Also check legacy single overlay
    if (pdfOverlay) {
        pdfOverlay.querySelectorAll('.overlay-box').forEach(box => {
            box.classList.remove('highlighted', 'active');
        });
    }
    
    // Highlight the matching region ONLY - NO SCROLLING on left side
    // Left side PDF stays completely static
    if (chunkId) {
        // Try to find in all page containers first
        const overlayBox = document.querySelector(`.pdf-overlay .overlay-box[data-chunk-id="${chunkId}"]`);
        if (overlayBox) {
            overlayBox.classList.add('highlighted', 'active');
            // NO SCROLLING - just highlight the region
        } else if (pdfOverlay) {
            // Fallback to legacy single overlay
            const legacyBox = pdfOverlay.querySelector(`.overlay-box[data-chunk-id="${chunkId}"]`);
            if (legacyBox) {
                legacyBox.classList.add('highlighted', 'active');
            }
        }
    }
}

function scrollStageIntoView() {
    const stage = document.querySelector('.document-stage');
    if (stage) {
        stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

async function renderDocumentPreview(docData) {
    if (!pdfWrapper) return;
    if (!docData || docData.status !== 'complete') {
        if (pdfWrapper) pdfWrapper.innerHTML = '';
        if (pageIndicator) pageIndicator.textContent = 'Preview unavailable';
        pdfDocInstance = null;
        currentOverlayChunks = [];
        return;
    }

    const docId = docData.document_id || selectedDocumentId;
    if (!docId) return;
    
    // Reset counters for new document
    resetCounters();
    
    // Detect file type from filename
    const filename = docData.filename || '';
    const fileExtension = filename.split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'webp'].includes(fileExtension);
    const isPdf = fileExtension === 'pdf';
    
    const fileUrl = `${API_BASE_URL}/documents/${docId}/file?cache=${Date.now()}`;
    
    try {
        // Get auth token
        const token = getAuthToken();
        const headers = {};
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        if (isImage) {
            // Render image file
            if (pageIndicator) {
                pageIndicator.textContent = 'Image';
            }
            
            // Disable navigation buttons for images
            if (pdfPrevButton) pdfPrevButton.disabled = true;
            if (pdfNextButton) pdfNextButton.disabled = true;
            
            // Create image element - use window.document to access global document object
            const img = window.document.createElement('img');
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            img.style.margin = '0 auto';
            img.style.borderRadius = '8px';
            img.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
            
            // Handle image load
            img.onload = () => {
                // Draw overlays if chunks are available
                currentOverlayChunks = docData.detected_chunks || [];
                if (currentOverlayChunks && currentOverlayChunks.length > 0) {
                    drawImageOverlays(img, currentOverlayChunks);
                }
            };
            
            img.onerror = () => {
                pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                    <p>Unable to load image preview.</p>
                </div>`;
            };
            
            // Load image with authentication
            if (token) {
                // For images, we need to use fetch and create object URL
                fetch(fileUrl, {
                    credentials: 'include',
                    headers: headers
                })
                .then(response => {
                    if (!response.ok) throw new Error('Failed to load image');
                    return response.blob();
                })
                .then(blob => {
                    const objectUrl = URL.createObjectURL(blob);
                    img.src = objectUrl;
                    pdfWrapper.innerHTML = '';
                    pdfWrapper.appendChild(img);
                })
                .catch(error => {
                    console.error('Error loading image:', error);
                    pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                        <p>Unable to load image preview.</p>
                        <p style="font-size: 0.85rem; margin-top: 8px;">${error.message || 'Unknown error'}</p>
                    </div>`;
                });
            } else {
                img.src = fileUrl;
                pdfWrapper.innerHTML = '';
                pdfWrapper.appendChild(img);
            }
            
        } else if (isPdf && window.pdfjsLib) {
            // Render PDF file
            const loadingTask = window.pdfjsLib.getDocument({
                url: fileUrl,
                httpHeaders: headers,
                withCredentials: true
            });
            
            pdfDocInstance = await loadingTask.promise;
            currentOverlayChunks = docData.detected_chunks || [];
        
        // Pre-assign numbers to all chunks for consistent labeling
        if (currentOverlayChunks) {
            currentOverlayChunks.forEach(chunk => {
                const chunkType = (chunk.type || 'text').toLowerCase();
                getNumberedLabel(chunkType, chunk.id || '');
            });
        }
        
        await renderAllPdfPages();
        } else {
            // Unsupported file type
            pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p>Preview not available for this file type.</p>
            </div>`;
            if (pageIndicator) {
                pageIndicator.textContent = 'Preview unavailable';
            }
        }
    } catch (error) {
        console.error('Error loading preview:', error);
        if (pageIndicator) {
            pageIndicator.textContent = 'Preview unavailable';
        }
        // Show error message in PDF wrapper
        if (pdfWrapper) {
            pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p>Unable to load preview. Please try again.</p>
                <p style="font-size: 0.85rem; margin-top: 8px;">${error.message || 'Unknown error'}</p>
            </div>`;
        }
    }
}

// Draw overlays on image
function drawImageOverlays(imgElement, chunks) {
    if (!imgElement || !chunks || chunks.length === 0) return;
    
    // Wait for image to load
    if (!imgElement.complete) {
        imgElement.onload = () => drawImageOverlays(imgElement, chunks);
        return;
    }
    
    // Get image dimensions after load
    const imgWidth = imgElement.naturalWidth || imgElement.width;
    const imgHeight = imgElement.naturalHeight || imgElement.height;
    const displayWidth = imgElement.offsetWidth || imgElement.clientWidth;
    const displayHeight = imgElement.offsetHeight || imgElement.clientHeight;
    
    if (!imgWidth || !imgHeight) {
        // Wait a bit more if dimensions aren't available
        setTimeout(() => drawImageOverlays(imgElement, chunks), 100);
        return;
    }
    
    const scaleX = displayWidth / imgWidth;
    const scaleY = displayHeight / imgHeight;
    
    // Create overlay container
    const overlay = window.document.createElement('div');
    overlay.className = 'pdf-overlay';
    overlay.style.position = 'absolute';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = `${displayWidth}px`;
    overlay.style.height = `${displayHeight}px`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '10';
    
    // Draw bounding boxes for chunks
    chunks.forEach(chunk => {
        if (chunk.bbox && Array.isArray(chunk.bbox) && chunk.bbox.length >= 4) {
            const [x, y, width, height] = chunk.bbox;
            
            const box = window.document.createElement('div');
            box.className = 'overlay-box';
            box.style.left = `${x * scaleX}px`;
            box.style.top = `${y * scaleY}px`;
            box.style.width = `${width * scaleX}px`;
            box.style.height = `${height * scaleY}px`;
            
            const chunkType = (chunk.type || 'text').toLowerCase();
            const label = getNumberedLabel(chunkType, chunk.id || '');
            
            const labelSpan = window.document.createElement('span');
            labelSpan.textContent = label;
            labelSpan.className = 'overlay-label';
            box.appendChild(labelSpan);
            
            // Add hover event listeners to show/hide label
            box.addEventListener('mouseenter', () => {
                labelSpan.style.opacity = '1';
                labelSpan.style.visibility = 'visible';
            });
            box.addEventListener('mouseleave', () => {
                labelSpan.style.opacity = '0';
                labelSpan.style.visibility = 'hidden';
            });
            // Also support touch events for mobile
            box.addEventListener('touchstart', () => {
                labelSpan.style.opacity = '1';
                labelSpan.style.visibility = 'visible';
            });
            
            overlay.appendChild(box);
        }
    });
    
    // Wrap image and overlay in container if not already wrapped
    let container = imgElement.parentElement;
    if (!container || !container.classList.contains('image-container')) {
        container = window.document.createElement('div');
        container.className = 'image-container';
        container.style.position = 'relative';
        container.style.display = 'inline-block';
        container.style.width = '100%';
        container.style.textAlign = 'center';
        
        const parent = imgElement.parentNode;
        parent.insertBefore(container, imgElement);
        container.appendChild(imgElement);
    }
    
    container.appendChild(overlay);
}

// Render all PDF pages stacked vertically
async function renderAllPdfPages() {
    if (!pdfDocInstance || !pdfWrapper) return;
    const totalPages = pdfDocInstance.numPages;
    
    // Clear wrapper
    pdfWrapper.innerHTML = '';
    
    // Update page indicator - show current page / total pages
    if (pageIndicator) {
        pageIndicator.textContent = `1 / ${totalPages}`;
    }
    
    // Disable navigation buttons since we're showing all pages
    if (pdfPrevButton) {
        pdfPrevButton.disabled = true;
    }
    if (pdfNextButton) {
        pdfNextButton.disabled = true;
    }
    
    const wrapperWidth = pdfWrapper.clientWidth;
    let totalHeight = 0;
    
    // Render all pages
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        try {
            const page = await pdfDocInstance.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1 });
            
            // Account for device pixel ratio to prevent blurriness when zooming
            const devicePixelRatio = window.devicePixelRatio || 1;
            const scale = (wrapperWidth / baseViewport.width) * devicePixelRatio;
            const viewport = page.getViewport({ scale: scale / devicePixelRatio });
            
            // Create container for this page
            const pageContainer = document.createElement('div');
            pageContainer.className = 'pdf-page-container';
            pageContainer.style.position = 'relative';
            pageContainer.style.marginBottom = '20px';
            pageContainer.style.width = `${viewport.width}px`;
            pageContainer.style.height = `${viewport.height}px`;
            pageContainer.dataset.pageNumber = pageNum;
            
            // Create canvas for this page with high DPI support
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            // Set canvas size accounting for device pixel ratio
            canvas.width = viewport.width * devicePixelRatio;
            canvas.height = viewport.height * devicePixelRatio;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            
            // Scale context to account for device pixel ratio
            context.scale(devicePixelRatio, devicePixelRatio);
            
            // Use high-quality rendering
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            
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
        
        // Account for device pixel ratio to prevent blurriness when zooming
        const devicePixelRatio = window.devicePixelRatio || 1;
        const scale = (wrapperWidth / baseViewport.width) * devicePixelRatio;
        const viewport = page.getViewport({ scale: scale / devicePixelRatio });

        // Set canvas size accounting for device pixel ratio
        pdfCanvas.width = viewport.width * devicePixelRatio;
        pdfCanvas.height = viewport.height * devicePixelRatio;
        pdfCanvas.style.width = `${viewport.width}px`;
        pdfCanvas.style.height = `${viewport.height}px`;
        
        // Reset transform and scale context to account for device pixel ratio
        pdfContext.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        pdfContext.scale(devicePixelRatio, devicePixelRatio);
        
        // Use high-quality rendering
        pdfContext.imageSmoothingEnabled = true;
        pdfContext.imageSmoothingQuality = 'high';

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
        const overlayBox = window.document.createElement('div');
        overlayBox.className = 'overlay-box';
        overlayBox.style.position = 'absolute';
        overlayBox.style.left = `${box.left * viewport.width}px`;
        overlayBox.style.top = `${box.top * viewport.height}px`;
        overlayBox.style.width = `${(box.right - box.left) * viewport.width}px`;
        overlayBox.style.height = `${(box.bottom - box.top) * viewport.height}px`;
        // Get chunk ID - try multiple sources
        let chunkId = chunk.id || chunk.chunk_id || '';
        if (!chunkId && chunk.grounding && chunk.grounding.id) {
            chunkId = chunk.grounding.id;
        }
        overlayBox.dataset.chunkId = chunkId || '';
        overlayBox.style.pointerEvents = 'auto';
        overlayBox.style.cursor = 'pointer';

        const label = window.document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        // Get numbered label based on type
        const numberedLabel = getNumberedLabel(chunkType, chunkId || '');
        label.textContent = numberedLabel;
        label.className = 'overlay-label';
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
            highlightChunk(chunkId || '');
            highlightMarkdownSection(chunkId || '');
        });
        overlayBox.addEventListener('mouseleave', () => {
            label.style.opacity = '0';
            label.style.visibility = 'hidden';
            highlightChunk(null);
            highlightMarkdownSection(null);
        });
        // Also support touch events for mobile
        overlayBox.addEventListener('touchstart', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
        });
        overlayBox.addEventListener('click', (e) => {
            e.stopPropagation();
            // Get chunk ID - try multiple sources
            let chunkId = chunk.id || chunk.chunk_id || '';
            if (!chunkId && chunk.grounding && chunk.grounding.id) {
                chunkId = chunk.grounding.id;
            }
            console.log('PDF overlay clicked (drawPageOverlays), chunkId:', chunkId, 'chunk:', chunk);
            if (chunkId) {
                // Scroll RIGHT panel (parse-content) to show corresponding markdown section
                // Left side PDF stays static - no scrolling
                scrollToMarkdownSection(String(chunkId));
            } else {
                console.warn('PDF overlay clicked but no chunkId found for chunk:', chunk);
            }
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
        const overlayBox = window.document.createElement('div');
        overlayBox.className = 'overlay-box';
        overlayBox.style.left = `${box.left * viewport.width}px`;
        overlayBox.style.top = `${box.top * viewport.height}px`;
        overlayBox.style.width = `${(box.right - box.left) * viewport.width}px`;
        overlayBox.style.height = `${(box.bottom - box.top) * viewport.height}px`;
        // Get chunk ID - try multiple sources
        let chunkId = chunk.id || chunk.chunk_id || '';
        if (!chunkId && chunk.grounding && chunk.grounding.id) {
            chunkId = chunk.grounding.id;
        }
        overlayBox.dataset.chunkId = chunkId || '';

        const label = window.document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        const numberedLabel = getNumberedLabel(chunkType, chunkId || '');
        label.textContent = numberedLabel;
        label.className = 'overlay-label';
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
            highlightChunk(chunkId || '');
            highlightMarkdownSection(chunkId || '');
        });
        overlayBox.addEventListener('mouseleave', () => {
            label.style.opacity = '0';
            label.style.visibility = 'hidden';
            highlightChunk(null);
            highlightMarkdownSection(null);
        });
        // Also support touch events for mobile
        overlayBox.addEventListener('touchstart', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
        });
        overlayBox.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('PDF overlay clicked (drawOverlays), chunkId:', chunkId, 'chunk:', chunk);
            if (chunkId) {
                scrollToMarkdownSection(String(chunkId));
            } else {
                console.warn('PDF overlay clicked but no chunkId found for chunk:', chunk);
            }
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

// Add event listeners for page navigation buttons
if (pdfPrevButton) {
    pdfPrevButton.addEventListener('click', () => navigatePdf(-1));
}
if (pdfNextButton) {
    pdfNextButton.addEventListener('click', () => navigatePdf(1));
}

// Set up chat event listeners
if (chatSendButton) {
    chatSendButton.addEventListener('click', sendChatMessage);
}

if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
}

// Function to send a chat message
async function sendChatMessage() {
    const query = chatInput.value.trim();
    
    if (!query) {
        return;
    }
    
    if (!selectedDocumentId) {
        // Show chat messages area
        if (chatMessages) {
            chatMessages.style.display = 'flex';
        }
        const errorMsg = document.createElement('div');
        errorMsg.className = 'message response';
        errorMsg.innerHTML = '<div>Please select a document first.</div>';
        chatMessages.appendChild(errorMsg);
        return;
    }
    
    // Hide example prompts when user starts chatting
    const examplePromptsSection = document.getElementById('example-prompts-section');
    if (examplePromptsSection) {
        examplePromptsSection.style.display = 'none';
    }
    
    // Show chat messages area
    if (chatMessages) {
        chatMessages.style.display = 'flex';
    }
    
    // Add user query to chat
    const userMessage = document.createElement('div');
    userMessage.className = 'message query';
    userMessage.innerHTML = `<div>${escapeHtml(query)}</div>`;
    chatMessages.appendChild(userMessage);
    
    // Clear input
    chatInput.value = '';
    
    // Disable send button while processing
    if (chatSendButton) {
        chatSendButton.disabled = true;
    }
    
    // Add typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'message response typing-indicator';
    typingIndicator.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    chatMessages.appendChild(typingIndicator);
    
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
        const responseMessage = document.createElement('div');
        responseMessage.className = 'message response';
        
        // Format answer with markdown rendering
        let answerHtml = '';
        const numericMatch = data.answer.match(/^[\d,]+(?:\.\d+)?$/);
        
        if (numericMatch && data.sources && data.sources.length > 0) {
            // If answer is just a number and we have sources, show it with icon
            answerHtml = `
                <div class="answer-with-icon">
                    <div class="answer-icon">📊</div>
                    <div class="answer-value">${escapeHtml(data.answer)}</div>
                </div>
            `;
        } else {
            // Render markdown for rich formatting
            answerHtml = renderMarkdown(data.answer);
        }
        
        // Remove typing indicator
        const typingIndicator = chatMessages.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        responseMessage.innerHTML = `
            ${answerHtml}
            ${sourceText ? `<span class="source-tag ${sourceClass}">${sourceText}</span>` : ''}
            ${citationHtml}
        `;
        chatMessages.appendChild(responseMessage);
        attachCitationHandlers();
        
        // Re-enable send button
        if (chatSendButton) {
            chatSendButton.disabled = false;
        }
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error getting answer:', error);
        
        // Remove typing indicator
        const typingIndicator = chatMessages.querySelector('.typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
        
        const errorMessage = document.createElement('div');
        errorMessage.className = 'message response';
        errorMessage.innerHTML = `<div>Error getting answer: ${escapeHtml(error.message)}</div>`;
        chatMessages.appendChild(errorMessage);
        
        // Re-enable send button
        if (chatSendButton) {
            chatSendButton.disabled = false;
        }
        
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Function to generate example prompts based on parsed data
function updateExamplePrompts(docData) {
    const examplePromptsList = document.getElementById('example-prompts-list');
    const examplePromptsSection = document.getElementById('example-prompts-section');
    
    if (!examplePromptsList || !examplePromptsSection) return;
    
    // Clear existing prompts
    examplePromptsList.innerHTML = '';
    
    // Generate prompts based on document data
    const prompts = [];
    
    if (docData && docData.detected_chunks && docData.detected_chunks.length > 0) {
        // Check for common financial document patterns
        const markdown = docData.document_markdown || '';
        const chunks = docData.detected_chunks || [];
        
        // Look for total amount, due date, or other key information
        const hasAmount = markdown.toLowerCase().includes('total') || 
                         markdown.toLowerCase().includes('amount') ||
                         markdown.toLowerCase().includes('due');
        
        const hasDate = markdown.toLowerCase().includes('date') ||
                       markdown.toLowerCase().includes('due date');
        
        const hasBank = markdown.toLowerCase().includes('bank') ||
                       markdown.toLowerCase().includes('account');
        
        // Generate prompts based on detected content
        if (hasAmount) {
            // Extract potential name from document
            let name = '';
            const nameMatch = markdown.match(/(?:name|student|customer)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
            if (nameMatch) {
                name = nameMatch[1];
            }
            
            if (name) {
                prompts.push(`What is the total amount due for ${name}?`);
            } else {
                prompts.push('What is the total amount due?');
            }
        }
        
        if (hasDate) {
            prompts.push('What is the due date for payment?');
        }
        
        if (hasBank) {
            prompts.push('Which bank and account number should be used for payment?');
        }
    }
    
    // If no specific prompts generated, use generic ones
    if (prompts.length === 0) {
        prompts.push('What is the total amount due?');
        prompts.push('What is the due date for payment?');
    }
    
    // Limit to 2 prompts as requested
    const displayPrompts = prompts.slice(0, 2);
    
    // Create prompt elements
    displayPrompts.forEach(prompt => {
        const promptElement = document.createElement('div');
        promptElement.className = 'example-prompt';
        promptElement.textContent = prompt;
        promptElement.addEventListener('click', () => {
            chatInput.value = prompt;
            chatInput.focus();
        });
        examplePromptsList.appendChild(promptElement);
    });
    
    // Show section if we have prompts
    if (displayPrompts.length > 0) {
        examplePromptsSection.style.display = 'block';
    } else {
        examplePromptsSection.style.display = 'none';
    }
}

