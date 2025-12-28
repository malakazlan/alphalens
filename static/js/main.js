// Main.js - Core initialization and module coordination
// This file coordinates all modules and handles initialization

// PDF.js setup
if (window['pdfjs-dist/build/pdf']) {
    window.pdfjsLib = window['pdfjs-dist/build/pdf'];
}
if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// API endpoint - must be defined before modules load
const API_BASE_URL = window.location.origin;

// Load modules in order (dependencies first)
// Modules are loaded via script tags in HTML, so they should be available here

// DOM elements - cached for performance
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

// Handle window resize for responsive PDF overlays
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Redraw all PDF pages on resize if we're showing all pages
        const getPdfDocInstance = window.getPdfDocInstance || (() => null);
        const pdfDoc = getPdfDocInstance();
        if (pdfDoc && pdfWrapper && pdfWrapper.querySelector('.pdf-page-container')) {
            if (typeof renderAllPdfPages === 'function') {
                    renderAllPdfPages();
            }
        } else if (pdfDoc && typeof renderPdfPage === 'function') {
            const getCurrentPdfPage = window.getCurrentPdfPage || (() => 1);
            renderPdfPage(getCurrentPdfPage());
        }
    }, 250);
});

// Set up form submission for document upload
if (uploadForm) {
    uploadForm.addEventListener('submit', (e) => {
        if (typeof uploadDocument === 'function') {
            uploadDocument(e);
        }
    });
}

// Upload icon button - opens file input and triggers upload
const fileSelectBtn = document.getElementById('file-select-btn');
if (fileSelectBtn) {
    fileSelectBtn.addEventListener('click', () => {
        // Use the action-card-file-input which exists in the analyzer section
    const fileInput = document.getElementById('action-card-file-input');
        if (fileInput) {
            // Reset the input to allow selecting the same file again
    fileInput.value = '';
    
            // Set up change handler to process the file upload
            const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (file) {
                    // Show loading state
                    if (typeof showAnalyzerLoadingState === 'function') {
            showAnalyzerLoadingState();
                    }
                    
                    // Process file upload with 'parse' action (default)
                    if (typeof processFileUpload === 'function') {
                        await processFileUpload(file, 'parse');
                    }
                }
                
                // Remove the event listener after use
                fileInput.removeEventListener('change', handleFileChange);
            };
            
            // Add change handler
            fileInput.addEventListener('change', handleFileChange, { once: true });
            
            // Trigger file input click
            fileInput.click();
        } else {
            console.error('File input not found');
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
    const markdownView = document.getElementById('markdown-view');
    const jsonView = document.getElementById('json-view');
        if (markdownView) markdownView.style.display = viewType === 'markdown' ? 'block' : 'none';
        if (jsonView) jsonView.style.display = viewType === 'json' ? 'block' : 'none';
    });
});

// Add event listeners for PDF page navigation buttons
if (pdfPrevButton) {
    pdfPrevButton.addEventListener('click', () => {
        if (typeof navigatePdf === 'function') {
            navigatePdf(-1);
    }
    });
    }
    if (pdfNextButton) {
    pdfNextButton.addEventListener('click', () => {
        if (typeof navigatePdf === 'function') {
            navigatePdf(1);
        }
    });
}

// Set up chat event listeners
if (chatSendButton) {
    chatSendButton.addEventListener('click', () => {
        if (typeof sendChatMessage === 'function') {
            sendChatMessage();
}
    });
}

if (chatInput) {
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (typeof sendChatMessage === 'function') {
            sendChatMessage();
        }
        }
    });
}

// Main initialization - runs when DOM is ready
window.addEventListener('DOMContentLoaded', async () => {
    // Check authentication first
    if (typeof checkAuthentication === 'function') {
        await checkAuthentication();
    }
    
    // Show homepage by default
    if (typeof showHomePage === 'function') {
        showHomePage();
    }
    
    // Load documents
    if (typeof loadDocuments === 'function') {
        loadDocuments();
    }
    
    // Initialize UI components
    if (typeof initializeSidebar === 'function') {
        initializeSidebar();
        }
        
    if (typeof initializeResizer === 'function') {
        initializeResizer();
    }
});
    
// Export API_BASE_URL for modules
window.API_BASE_URL = API_BASE_URL;
