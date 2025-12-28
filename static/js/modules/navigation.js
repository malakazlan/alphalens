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
    // Save analyzer state before switching away
    const currentSection = document.getElementById('analyzer-section');
    if (currentSection && currentSection.style.display !== 'none') {
        // We're currently on analyzer, save state before leaving
        if (typeof saveAnalyzerState === 'function') {
            saveAnalyzerState();
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
            
            // Clear any saved state when navigating to analyzer
            // User can always select a document from the initial state
            if (typeof clearAnalyzerState === 'function') {
                clearAnalyzerState();
            }
            
            // CRITICAL: Always show initial state when navigating to analyzer
            // This ensures a clean start and avoids empty page issues
            if (typeof showAnalyzerInitialState === 'function') {
                showAnalyzerInitialState();
            }
            
            // Double-check initial state is visible after a brief delay
            setTimeout(() => {
                const initialState = document.getElementById('analyzer-initial-state');
                const resultState = document.getElementById('analyzer-result-state');
                
                // Force hide result state if it's still visible
                if (resultState) {
                    resultState.style.setProperty('display', 'none', 'important');
                    resultState.style.setProperty('visibility', 'hidden', 'important');
                    resultState.style.setProperty('opacity', '0', 'important');
                    resultState.style.setProperty('z-index', '-1', 'important');
                }
                
                // Force show initial state
                if (initialState) {
                    initialState.style.setProperty('display', 'block', 'important');
                    initialState.style.setProperty('visibility', 'visible', 'important');
                    initialState.style.setProperty('opacity', '1', 'important');
                    initialState.style.setProperty('z-index', '10', 'important');
                }
                
                // Ensure analyzer section is visible
                if (analyzerSection) {
                    analyzerSection.style.display = 'block';
                }
                
                // Reload pre-saved documents to refresh the list
                if (typeof loadPresavedDocuments === 'function') {
                    loadPresavedDocuments();
                }
            }, 50);
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

