// UI Components Module
// Handles sidebar, resizer, analyzer states, and UI interactions

// Analyzer State Management
let currentAnalyzerState = 'initial'; // 'initial', 'loading', 'result'

// State persistence functions
function saveAnalyzerState() {
    const state = {
        analyzerState: currentAnalyzerState,
        selectedDocumentId: typeof window.getSelectedDocumentId === 'function' ? window.getSelectedDocumentId() : null
    };
    sessionStorage.setItem('analyzerState', JSON.stringify(state));
}

function restoreAnalyzerState() {
    try {
        const savedState = sessionStorage.getItem('analyzerState');
        if (savedState) {
            const state = JSON.parse(savedState);
            return state;
        }
    } catch (error) {
        console.error('Error restoring analyzer state:', error);
    }
    return null;
}

function clearAnalyzerState() {
    sessionStorage.removeItem('analyzerState');
}

function showAnalyzerInitialState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    const analyzerContainer = document.getElementById('analyzer-section');
    const pageContainer = document.querySelector('.page');
    
    // CRITICAL: Ensure analyzer section is visible and has proper styling
    if (analyzerContainer) {
        analyzerContainer.style.display = 'block';
        analyzerContainer.style.position = 'relative';
        analyzerContainer.style.zIndex = '1';
        // Restore padding that was removed by result-state-active
        analyzerContainer.style.padding = '24px clamp(16px, 4vw, 60px)';
        analyzerContainer.style.minHeight = 'calc(100vh - 200px)';
        analyzerContainer.style.height = 'auto';
        analyzerContainer.style.overflow = 'visible';
    }
    
    // CRITICAL: Completely hide result state - it has absolute positioning that covers everything
    if (resultState) {
        resultState.style.setProperty('display', 'none', 'important');
        resultState.style.setProperty('visibility', 'hidden', 'important');
        resultState.style.setProperty('opacity', '0', 'important');
        resultState.style.setProperty('pointer-events', 'none', 'important');
        resultState.style.setProperty('z-index', '-1', 'important');
        resultState.style.setProperty('position', 'absolute', 'important');
        // Hide dashboard inside result state
        const dashboard = resultState.querySelector('.dashboard');
        if (dashboard) {
            dashboard.style.setProperty('display', 'none', 'important');
        }
    }
    
    // Completely hide loading state
    if (loadingState) {
        loadingState.style.setProperty('display', 'none', 'important');
        loadingState.style.setProperty('visibility', 'hidden', 'important');
        loadingState.style.setProperty('opacity', '0', 'important');
        loadingState.style.setProperty('pointer-events', 'none', 'important');
        loadingState.style.setProperty('z-index', '-1', 'important');
    }
    
    // CRITICAL: Show initial state with all properties - make it clearly visible
    if (initialState) {
        initialState.style.setProperty('display', 'block', 'important');
        initialState.style.setProperty('visibility', 'visible', 'important');
        initialState.style.setProperty('opacity', '1', 'important');
        initialState.style.setProperty('pointer-events', 'auto', 'important');
        initialState.style.setProperty('position', 'relative', 'important');
        initialState.style.setProperty('z-index', '10', 'important');
        initialState.style.setProperty('width', '100%', 'important');
        initialState.style.setProperty('height', 'auto', 'important');
        initialState.style.setProperty('min-height', 'auto', 'important');
        initialState.style.setProperty('background', 'transparent', 'important');
    }
    
    // Remove classes to restore padding
    if (analyzerContainer) {
        analyzerContainer.classList.remove('result-state-active');
    }
    if (pageContainer) {
        pageContainer.classList.remove('analyzer-result-active');
    }
    
    currentAnalyzerState = 'initial';
    saveAnalyzerState();
    
    // Force a reflow to ensure styles are applied
    if (initialState) {
        initialState.offsetHeight; // Trigger reflow
    }
}

function showAnalyzerLoadingState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    const analyzerContainer = document.getElementById('analyzer-section');
    
    // Hide initial state
    if (initialState) {
        initialState.style.display = 'none';
        initialState.style.visibility = 'hidden';
        initialState.style.opacity = '0';
    }
    
    // Hide result state completely
    if (resultState) {
        resultState.style.display = 'none';
        resultState.style.visibility = 'hidden';
        resultState.style.opacity = '0';
        resultState.style.pointerEvents = 'none';
        // Hide all children
        const dashboard = resultState.querySelector('.dashboard');
        if (dashboard) {
            dashboard.style.display = 'none';
        }
    }
    
    // Show loading state
    if (loadingState) {
        // Chrome-compatible display fix
        loadingState.style.display = 'flex';
        loadingState.style.visibility = 'visible';
        loadingState.style.opacity = '1';
        loadingState.style.pointerEvents = 'auto';
        // Force reflow for Chrome
        loadingState.offsetHeight;
    }
    
    // Remove result state classes from container
    if (analyzerContainer) {
        analyzerContainer.classList.remove('result-state-active');
    }
    
    currentAnalyzerState = 'loading';
    saveAnalyzerState();
}

function showAnalyzerResultState() {
    const initialState = document.getElementById('analyzer-initial-state');
    const loadingState = document.getElementById('analyzer-loading-state');
    const resultState = document.getElementById('analyzer-result-state');
    const analyzerContainer = document.getElementById('analyzer-section');
    const pageContainer = document.querySelector('.page');
    
    // Hide initial state
    if (initialState) {
        initialState.style.display = 'none';
        initialState.style.visibility = 'hidden';
        initialState.style.opacity = '0';
    }
    
    // Hide loading state completely - use !important to override any CSS
    if (loadingState) {
        loadingState.style.setProperty('display', 'none', 'important');
        loadingState.style.setProperty('visibility', 'hidden', 'important');
        loadingState.style.setProperty('opacity', '0', 'important');
        loadingState.style.setProperty('pointer-events', 'none', 'important');
        loadingState.style.setProperty('z-index', '-1', 'important');
    }
    
    // Show result state
    if (resultState) {
        resultState.style.display = 'block';
        resultState.style.visibility = 'visible';
        resultState.style.opacity = '1';
        resultState.style.pointerEvents = 'auto';
        resultState.style.zIndex = '1';
    }
    
    // Add classes to remove padding
    if (analyzerContainer) analyzerContainer.classList.add('result-state-active');
    if (pageContainer) pageContainer.classList.add('analyzer-result-active');
    
    currentAnalyzerState = 'result';
    saveAnalyzerState();
    
    // Initialize sidebar and resizer when result state is shown
    setTimeout(() => {
        initializeSidebar();
        if (typeof initializeResizer === 'function') {
            initializeResizer();
        }
        
        // Force sidebar to be visible
        const dashboard = resultState.querySelector('.dashboard');
        const sidebar = document.getElementById('workspace-sidebar');
        if (dashboard && sidebar) {
            // Show dashboard
            dashboard.style.display = 'grid';
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
            if (typeof pdfDocInstance !== 'undefined' && pdfDocInstance) {
                // Check if we're using multi-page view
                const pdfWrapper = document.getElementById('pdf-wrapper');
                const pageContainers = pdfWrapper?.querySelectorAll('.pdf-page-container');
                if (pageContainers && pageContainers.length > 0) {
                    // Multi-page view - redraw all pages
                    if (typeof renderAllPdfPages === 'function') {
                        renderAllPdfPages();
                    }
                } else if (typeof currentPdfPage !== 'undefined' && currentPdfPage) {
                    // Single page view - redraw current page
                    if (typeof renderPdfPage === 'function') {
                        renderPdfPage(currentPdfPage);
                    }
                }
            }
            
            // Redraw image if it exists
            const pdfWrapper = document.getElementById('pdf-wrapper');
            const imageContainer = pdfWrapper?.querySelector('.image-container');
            if (imageContainer) {
                const img = imageContainer.querySelector('img');
                if (img && img.complete) {
                    // Recalculate and redraw image overlays
                    if (typeof currentOverlayChunks !== 'undefined' && typeof drawImageOverlays === 'function') {
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

// Export functions
window.showAnalyzerInitialState = showAnalyzerInitialState;
window.showAnalyzerLoadingState = showAnalyzerLoadingState;
window.showAnalyzerResultState = showAnalyzerResultState;
window.initializeSidebar = initializeSidebar;
window.updateSidebarToggleVisibility = updateSidebarToggleVisibility;
window.initializeResizer = initializeResizer;

// Export state getter
window.getAnalyzerState = () => currentAnalyzerState;
window.saveAnalyzerState = saveAnalyzerState;
window.restoreAnalyzerState = restoreAnalyzerState;
window.clearAnalyzerState = clearAnalyzerState;

