// Navigation Module
// Handles feature switching, navigation links, and page routing

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
    // Save analyzer state before switching away (if we have a selected document)
    const currentSection = document.getElementById('analyzer-section');
    if (currentSection && currentSection.style.display !== 'none') {
        // We're currently on analyzer, save state before leaving
        const getSelectedDocumentId = window.getSelectedDocumentId || (() => null);
        const selectedDocId = getSelectedDocumentId();
        const getAnalyzerState = window.getAnalyzerState || (() => 'initial');
        const currentState = getAnalyzerState();
        
        // Only save state if we have a document selected and we're in result state
        if (selectedDocId && currentState === 'result') {
            if (typeof saveAnalyzerState === 'function') {
                saveAnalyzerState();
            }
        }
    }
    
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
        // Ensure report-modal-open class is removed (cleanup from PDF generation)
        document.body.classList.remove('report-modal-open');
        
        // Clean up any leftover PDF clones
        const leftoverClones = document.querySelectorAll('[id^="pdf-clone-"]');
        leftoverClones.forEach(clone => {
            if (clone.parentNode) {
                clone.parentNode.removeChild(clone);
            }
        });
        
        if (analyzerSection) {
            // CRITICAL: First ensure analyzer section is visible
            analyzerSection.style.display = 'block';
            analyzerSection.style.visibility = 'visible';
            analyzerSection.style.opacity = '1';
            
            // Check URL parameters first - if document ID is in URL, restore that state
            const getUrlParams = window.getUrlParams || (() => ({}));
            const urlParams = getUrlParams();
            
            // Also check sessionStorage for saved state (in case URL params were cleared)
            const restoreAnalyzerState = window.restoreAnalyzerState || (() => null);
            const savedState = restoreAnalyzerState();
            
            // Determine which document to restore (priority: URL params > sessionStorage > none)
            let documentToRestore = null;
            let stateToRestore = null;
            let tabToRestore = null;
            
            if (urlParams.document) {
                // URL has document - use that (state is optional, default to 'result')
                documentToRestore = urlParams.document;
                stateToRestore = urlParams.state || 'result';
                tabToRestore = urlParams.tab || null;
            } else if (savedState && savedState.selectedDocumentId) {
                // No URL params but we have saved state with a document - restore it
                documentToRestore = savedState.selectedDocumentId;
                stateToRestore = savedState.analyzerState || 'result';
                // Update URL to reflect the restored state
                if (typeof window.updateUrlParams === 'function') {
                    window.updateUrlParams({
                        document: documentToRestore,
                        state: stateToRestore
                    });
                }
            }
            
            // Only clear document content if we're NOT restoring
            if (!documentToRestore) {
                // Clear document content first
                const markdownView = document.getElementById('markdown-view');
                const jsonView = document.getElementById('json-content');
                const pdfWrapper = document.getElementById('pdf-wrapper');
                const selectedFileName = document.getElementById('selected-file-name');
                
                if (markdownView) markdownView.innerHTML = '';
                if (jsonView) jsonView.textContent = '';
                if (pdfWrapper) pdfWrapper.innerHTML = '';
                if (selectedFileName) selectedFileName.textContent = 'No document selected';
                
                // Clear chat messages
                const chatMessages = document.getElementById('chat-messages');
                if (chatMessages) {
                    chatMessages.innerHTML = '';
                    chatMessages.style.display = 'none';
                }
            }
            
            if (documentToRestore && stateToRestore) {
                // We have a document to restore - restore that state instead of showing initial
                // Set the selected document ID immediately so it's available
                if (typeof window.setSelectedDocumentId === 'function') {
                    window.setSelectedDocumentId(documentToRestore);
                }
                
                if (typeof selectDocument === 'function') {
                    // Load the document with cache enabled for instant restoration
                    // selectDocument will check cache first and show instantly if available
                    // No need to show loading state - selectDocument handles it intelligently
                    selectDocument(documentToRestore, true).then(() => {
                        // Ensure result state is shown after document loads (selectDocument should do this, but ensure it)
                        if (stateToRestore === 'result') {
                            // Double-check result state is shown
                            setTimeout(() => {
                                const getAnalyzerState = window.getAnalyzerState || (() => 'initial');
                                if (getAnalyzerState() !== 'result') {
                                    if (typeof showAnalyzerResultState === 'function') {
                                        showAnalyzerResultState();
                                    }
                                }
                                // Switch to tab if specified
                                if (tabToRestore) {
                                    const tab = document.querySelector(`[data-tab="${tabToRestore}"]`);
                                    if (tab) {
                                        tab.click();
                                    }
                                }
                            }, 300);
                        } else if (tabToRestore) {
                            // Switch to tab if specified
                            const tab = document.querySelector(`[data-tab="${tabToRestore}"]`);
                            if (tab) {
                                setTimeout(() => tab.click(), 200);
                            }
                        }
                    }).catch(error => {
                        console.error('Error restoring document:', error);
                        // Fall back to initial state on error
                        if (typeof showAnalyzerInitialState === 'function') {
                            showAnalyzerInitialState();
                        }
                    });
                }
            } else {
                // No document to restore - clear state and show initial
                // Clear document content first
                const markdownView = document.getElementById('markdown-view');
                const jsonView = document.getElementById('json-content');
                const pdfWrapper = document.getElementById('pdf-wrapper');
                const selectedFileName = document.getElementById('selected-file-name');
                
                if (markdownView) markdownView.innerHTML = '';
                if (jsonView) jsonView.textContent = '';
                if (pdfWrapper) pdfWrapper.innerHTML = '';
                if (selectedFileName) selectedFileName.textContent = 'No document selected';
                
                // Clear chat messages
                const chatMessages = document.getElementById('chat-messages');
                if (chatMessages) {
                    chatMessages.innerHTML = '';
                    chatMessages.style.display = 'none';
                }
                
                // Clear selected document when showing initial state
                if (typeof window.setSelectedDocumentId === 'function') {
                    window.setSelectedDocumentId(null);
                }
                
                // Clear any saved state when navigating to analyzer without a document
                if (typeof clearAnalyzerState === 'function') {
                    clearAnalyzerState();
                }
                
                // Clear URL params when showing initial state
                if (typeof window.clearUrlParams === 'function') {
                    window.clearUrlParams();
                }
                
                // Show initial state
                if (typeof showAnalyzerInitialState === 'function') {
                    showAnalyzerInitialState();
                }
            }
            
            // Reload pre-saved documents to refresh the list (always do this)
            // But only if we're not restoring a document (to avoid interference)
            if (!documentToRestore) {
                setTimeout(() => {
                    if (typeof loadPresavedDocuments === 'function') {
                        loadPresavedDocuments();
                    }
                    
                    // Ensure analyzer section is visible
                    if (analyzerSection) {
                        analyzerSection.style.display = 'block';
                    }
                }, 50);
            } else {
                // If restoring, wait longer to ensure restoration completes first
                setTimeout(() => {
                    if (typeof loadPresavedDocuments === 'function') {
                        loadPresavedDocuments();
                    }
                    
                    // Ensure analyzer section is visible
                    if (analyzerSection) {
                        analyzerSection.style.display = 'block';
                    }
                }, 500);
            }
        }
        updateNavLinks('analyzer');
        // Initialize analyzer functionality
        if (typeof initializeAnalyzer === 'function') {
            initializeAnalyzer();
        }
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

// Export functions
window.showHomePage = showHomePage;
window.showFeature = showFeature;
window.updateNavLinks = updateNavLinks;

