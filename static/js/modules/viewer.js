// Viewer Module
// Handles PDF/image rendering, overlays, and document preview

// Ensure API_BASE_URL is available
if (typeof API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// PDF/Image viewer state
let pdfDocInstance = null;
let currentPdfPage = 1;
let currentOverlayChunks = [];

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
    const overlay = document.createElement('div');
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
            
            const box = document.createElement('div');
            box.className = 'overlay-box';
            box.style.left = `${x * scaleX}px`;
            box.style.top = `${y * scaleY}px`;
            box.style.width = `${width * scaleX}px`;
            box.style.height = `${height * scaleY}px`;
            
            const chunkType = (chunk.type || 'text').toLowerCase();
            const label = getNumberedLabel(chunkType, chunk.id || '');
            
            const labelSpan = document.createElement('span');
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
        container = document.createElement('div');
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
    const pdfWrapper = document.getElementById('pdf-wrapper');
    if (!pdfDocInstance || !pdfWrapper) return;
    const totalPages = pdfDocInstance.numPages;
    
    // Clear wrapper completely - remove all existing content including static canvas
    pdfWrapper.innerHTML = '';
    
    // Also remove any legacy overlay elements that might exist
    const legacyOverlay = document.getElementById('pdf-overlay');
    if (legacyOverlay && legacyOverlay.parentNode === pdfWrapper) {
        legacyOverlay.remove();
    }
    
    // Update page indicator - show current page / total pages
    const pageIndicator = document.getElementById('page-indicator');
    if (pageIndicator) {
        pageIndicator.textContent = `1 / ${totalPages}`;
    }
    
    // Disable navigation buttons since we're showing all pages
    const pdfPrevButton = document.getElementById('pdf-prev');
    const pdfNextButton = document.getElementById('pdf-next');
    if (pdfPrevButton) {
        pdfPrevButton.disabled = true;
    }
    if (pdfNextButton) {
        pdfNextButton.disabled = true;
    }
    
    const wrapperWidth = pdfWrapper.clientWidth;
    
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
            
            // Create canvas for this page with high DPI support - Chrome compatible
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d', { 
                alpha: false,  // Chrome optimization
                desynchronized: false  // Chrome compatibility
            });
            
            // Set canvas size accounting for device pixel ratio
            // Chrome requires explicit integer values
            const canvasWidth = Math.floor(viewport.width * devicePixelRatio);
            const canvasHeight = Math.floor(viewport.height * devicePixelRatio);
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            canvas.style.width = `${viewport.width}px`;
            canvas.style.height = `${viewport.height}px`;
            
            // Chrome-specific: Clear canvas before rendering
            context.clearRect(0, 0, canvasWidth, canvasHeight);
            
            // Scale context to account for device pixel ratio
            context.scale(devicePixelRatio, devicePixelRatio);
            
            // Use high-quality rendering - Chrome compatible
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            // Chrome-specific smoothing properties
            if (context.imageSmoothingEnabled !== undefined) {
                context.imageSmoothingEnabled = true;
            }
            
            // Render page
            await page.render({ canvasContext: context, viewport }).promise;
            
            // Chrome-specific: Force canvas update
            canvas.style.imageRendering = 'auto';
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
        } catch (error) {
            console.error(`Error rendering PDF page ${pageNum}:`, error);
        }
    }
}

// Legacy single page render (kept for compatibility)
async function renderPdfPage(pageNumber) {
    const pdfCanvas = document.getElementById('pdf-canvas');
    const pdfWrapper = document.getElementById('pdf-wrapper');
    const pdfOverlay = document.getElementById('pdf-overlay');
    // Chrome-compatible context creation
    const pdfContext = pdfCanvas ? pdfCanvas.getContext('2d', { 
        alpha: false,  // Chrome optimization
        desynchronized: false  // Chrome compatibility
    }) : null;
    
    if (!pdfDocInstance || !pdfContext) return;
    const totalPages = pdfDocInstance.numPages;
    currentPdfPage = Math.min(Math.max(pageNumber, 1), totalPages);

    const pdfPrevButton = document.getElementById('pdf-prev');
    const pdfNextButton = document.getElementById('pdf-next');
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

        // Set canvas size accounting for device pixel ratio - Chrome compatible
        // Chrome requires explicit integer values
        const canvasWidth = Math.floor(viewport.width * devicePixelRatio);
        const canvasHeight = Math.floor(viewport.height * devicePixelRatio);
        pdfCanvas.width = canvasWidth;
        pdfCanvas.height = canvasHeight;
        pdfCanvas.style.width = `${viewport.width}px`;
        pdfCanvas.style.height = `${viewport.height}px`;
        
        // Chrome-specific: Clear canvas before rendering
        pdfContext.clearRect(0, 0, canvasWidth, canvasHeight);
        
        // Reset transform and scale context to account for device pixel ratio
        pdfContext.setTransform(1, 0, 0, 1, 0, 0); // Reset transform
        pdfContext.scale(devicePixelRatio, devicePixelRatio);
        
        // Use high-quality rendering - Chrome compatible
        pdfContext.imageSmoothingEnabled = true;
        pdfContext.imageSmoothingQuality = 'high';
        // Chrome-specific smoothing properties
        if (pdfContext.imageSmoothingEnabled !== undefined) {
            pdfContext.imageSmoothingEnabled = true;
        }

        await page.render({ canvasContext: pdfContext, viewport }).promise;
        
        // Chrome-specific: Force canvas update
        pdfCanvas.style.imageRendering = 'auto';
        if (typeof drawOverlays === 'function') {
            drawOverlays(viewport);
        }

        const pageIndicator = document.getElementById('page-indicator');
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
        // Get chunk ID - try multiple sources
        let chunkId = chunk.id || chunk.chunk_id || '';
        if (!chunkId && chunk.grounding && chunk.grounding.id) {
            chunkId = chunk.grounding.id;
        }
        overlayBox.dataset.chunkId = chunkId || '';
        overlayBox.style.pointerEvents = 'auto';
        overlayBox.style.cursor = 'pointer';

        const label = document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        // Get numbered label based on type
        const numberedLabel = getNumberedLabel(chunkType, chunkId || '');
        label.textContent = numberedLabel;
        label.className = 'overlay-label';
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
            if (typeof highlightChunk === 'function') {
                highlightChunk(chunkId || '');
            }
            if (typeof highlightMarkdownSection === 'function') {
                highlightMarkdownSection(chunkId || '');
            }
        });
        overlayBox.addEventListener('mouseleave', () => {
            label.style.opacity = '0';
            label.style.visibility = 'hidden';
            if (typeof highlightChunk === 'function') {
                highlightChunk(null);
            }
            if (typeof highlightMarkdownSection === 'function') {
                highlightMarkdownSection(null);
            }
        });
        // Also support touch events for mobile
        overlayBox.addEventListener('touchstart', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
        });
        overlayBox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (chunkId && typeof scrollToMarkdownSection === 'function') {
                scrollToMarkdownSection(String(chunkId));
            }
        });

        overlayElement.appendChild(overlayBox);
    });
}

// Legacy overlay function (kept for compatibility)
function drawOverlays(viewport) {
    const pdfOverlay = document.getElementById('pdf-overlay');
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
        // Get chunk ID - try multiple sources
        let chunkId = chunk.id || chunk.chunk_id || '';
        if (!chunkId && chunk.grounding && chunk.grounding.id) {
            chunkId = chunk.grounding.id;
        }
        overlayBox.dataset.chunkId = chunkId || '';

        const label = document.createElement('span');
        const chunkType = (chunk.type || 'zone').toLowerCase();
        const numberedLabel = getNumberedLabel(chunkType, chunkId || '');
        label.textContent = numberedLabel;
        label.className = 'overlay-label';
        overlayBox.appendChild(label);

        overlayBox.addEventListener('mouseenter', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
            if (typeof highlightChunk === 'function') {
                highlightChunk(chunkId || '');
            }
            if (typeof highlightMarkdownSection === 'function') {
                highlightMarkdownSection(chunkId || '');
            }
        });
        overlayBox.addEventListener('mouseleave', () => {
            label.style.opacity = '0';
            label.style.visibility = 'hidden';
            if (typeof highlightChunk === 'function') {
                highlightChunk(null);
            }
            if (typeof highlightMarkdownSection === 'function') {
                highlightMarkdownSection(null);
            }
        });
        // Also support touch events for mobile
        overlayBox.addEventListener('touchstart', () => {
            label.style.opacity = '1';
            label.style.visibility = 'visible';
        });
        overlayBox.addEventListener('click', (e) => {
            e.stopPropagation();
            if (chunkId && typeof scrollToMarkdownSection === 'function') {
                scrollToMarkdownSection(String(chunkId));
            }
        });

        pdfOverlay.appendChild(overlayBox);
    });
}

// Highlight PDF region
function highlightPdfRegion(chunkId) {
    // Find all overlay boxes in all page containers (for multi-page view)
    const allOverlayBoxes = document.querySelectorAll('.pdf-overlay .overlay-box');
    
    // Remove all highlights
    allOverlayBoxes.forEach(box => {
        box.classList.remove('highlighted', 'active');
    });
    
    // Also check legacy single overlay
    const pdfOverlay = document.getElementById('pdf-overlay');
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

// Render document preview (PDF or image)
// Track rendering state to prevent duplicates
let isRendering = false;
let lastRenderedDocId = null;

async function renderDocumentPreview(docData) {
    const pdfWrapper = document.getElementById('pdf-wrapper');
    const pageIndicator = document.getElementById('page-indicator');
    const getSelectedDocumentId = window.getSelectedDocumentId || (() => null);
    const selectedDocumentId = getSelectedDocumentId();
    
    if (!pdfWrapper) return;
    
    const docId = docData?.document_id || selectedDocumentId;
    
    // Prevent duplicate rendering - if already rendering the same document, skip
    if (isRendering && lastRenderedDocId === docId) {
        return;
    }
    
    // Prevent duplicate rendering - if document already rendered, skip unless data changed
    if (!isRendering && lastRenderedDocId === docId && pdfWrapper.children.length > 0) {
        // Check if we have processed data - if yes, document is already rendered
        if (docData?.detected_chunks && docData.detected_chunks.length > 0) {
            return;
        }
    }
    
    // Mark as rendering
    isRendering = true;
    lastRenderedDocId = docId;
    
    // Clear wrapper completely before rendering to prevent duplicates
    pdfWrapper.innerHTML = '';
    
    if (!docData || docData.status !== 'complete') {
        if (pageIndicator) pageIndicator.textContent = 'Preview unavailable';
        pdfDocInstance = null;
        isRendering = false;
        // Don't clear overlays if we're just missing data temporarily
        if (!docData || !docData.document_id) {
            currentOverlayChunks = [];
        }
        return;
    }
    
    // CRITICAL FIX: Don't render if we don't have processed data (detected_chunks)
    // This prevents clearing bounding boxes when incomplete data is passed
    if (!docData.detected_chunks && !docData.document_markdown) {
        console.log('Skipping renderDocumentPreview - no processed data available');
        isRendering = false;
        // Don't clear existing overlays if we already have them
        if (currentOverlayChunks && currentOverlayChunks.length > 0) {
            return; // Keep existing view
        }
        // But still clear the wrapper if we don't have any existing content
        return;
    }

    if (!docId) {
        isRendering = false;
        return;
    }
    
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
        const getAuthToken = window.getAuthToken || (() => null);
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
            const pdfPrevButton = document.getElementById('pdf-prev');
            const pdfNextButton = document.getElementById('pdf-next');
            if (pdfPrevButton) pdfPrevButton.disabled = true;
            if (pdfNextButton) pdfNextButton.disabled = true;
            
            // Create image element
            const img = document.createElement('img');
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
            
            // Load image with authentication - always use fetch to ensure cookies/headers are sent
            fetch(fileUrl, {
                credentials: 'include',
                headers: headers
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
                }
                return response.blob();
            })
            .then(blob => {
                const objectUrl = URL.createObjectURL(blob);
                img.src = objectUrl;
                pdfWrapper.innerHTML = '';
                pdfWrapper.appendChild(img);
                isRendering = false;
            })
            .catch(error => {
                console.error('Error loading image:', error);
                pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                    <p>Unable to load image preview.</p>
                    <p style="font-size: 0.85rem; margin-top: 8px;">${error.message || 'Unknown error'}</p>
                </div>`;
                isRendering = false;
            });
            
        } else if (isPdf && window.pdfjsLib) {
            // Render PDF file - use fetch to ensure authentication works
            try {
                // Fetch PDF as blob with authentication
                const response = await fetch(fileUrl, {
                    credentials: 'include',
                    headers: headers
                });
                
                if (!response.ok) {
                    throw new Error(`Failed to load PDF: ${response.status} ${response.statusText}`);
                }
                
                const blob = await response.blob();
                const objectUrl = URL.createObjectURL(blob);
                
                // Load PDF from blob URL
                const loadingTask = window.pdfjsLib.getDocument({
                    url: objectUrl,
                    withCredentials: false  // Not needed for blob URLs
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
                isRendering = false;
            } catch (pdfError) {
                console.error('Error loading PDF:', pdfError);
                isRendering = false;
                throw pdfError; // Re-throw to be caught by outer catch
            }
        } else {
            // Unsupported file type
            pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p>Preview not available for this file type.</p>
            </div>`;
            if (pageIndicator) {
                pageIndicator.textContent = 'Preview unavailable';
            }
            isRendering = false;
        }
    } catch (error) {
        console.error('Error loading preview:', error);
        isRendering = false;
        if (pageIndicator) {
            pageIndicator.textContent = 'Preview unavailable';
        }
        // Show error message in PDF wrapper
        if (pdfWrapper) {
            let errorMessage = 'Unable to load preview. Please try again.';
            if (error.message && error.message.includes('File not found')) {
                errorMessage = 'File was deleted from storage. This document is no longer available.';
            } else if (error.message && error.message.includes('404')) {
                errorMessage = 'File not found. This document may have been deleted.';
            }
            pdfWrapper.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary);">
                <p style="color: var(--error); font-weight: 500; margin-bottom: 8px;">⚠️ ${errorMessage}</p>
                <p style="font-size: 0.85rem; margin-top: 8px; color: var(--text-secondary);">${error.message || 'Unknown error'}</p>
            </div>`;
        }
    }
}

function navigatePdf(delta) {
    if (!pdfDocInstance) return;
    renderPdfPage(currentPdfPage + delta);
}

// Export functions
window.renderDocumentPreview = renderDocumentPreview;
window.renderAllPdfPages = renderAllPdfPages;
window.renderPdfPage = renderPdfPage;
window.drawImageOverlays = drawImageOverlays;
window.drawPageOverlays = drawPageOverlays;
window.drawOverlays = drawOverlays;
window.highlightPdfRegion = highlightPdfRegion;
window.navigatePdf = navigatePdf;
window.getNumberedLabel = getNumberedLabel;
window.resetCounters = resetCounters;
window.getPdfDocInstance = () => pdfDocInstance;
window.setPdfDocInstance = (instance) => { pdfDocInstance = instance; };
window.getCurrentOverlayChunks = () => currentOverlayChunks;
window.setCurrentOverlayChunks = (chunks) => { currentOverlayChunks = chunks; };

