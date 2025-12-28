// Documents Module
// Handles document loading, uploading, polling, and selection

// Ensure API_BASE_URL and dependencies are available
if (typeof API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// Store the currently selected document
let selectedDocumentId = null;
let pollingInterval = null;

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

// Function to load documents
async function loadDocuments() {
    try {
        const getAuthHeaders = window.getAuthHeaders || (() => ({}));
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
        // Only poll if there are documents that are not complete
        const hasProcessingDocs = documents.some(doc => doc.status !== 'complete' && doc.status !== 'error');
        if (documents.length > 0 && hasProcessingDocs) {
            pollDocumentStatus();
        }
    } catch (error) {
        console.error('Error loading documents:', error);
        const documentStatus = document.getElementById('document-status');
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
    const documentList = document.getElementById('document-list');
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
        
        listItem.addEventListener('click', () => {
            if (typeof selectDocument === 'function') {
                selectDocument(doc.document_id);
            }
        });
        
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
            if (typeof showAnalyzerLoadingState === 'function') {
                showAnalyzerLoadingState();
            }
            try {
                if (typeof selectDocument === 'function') {
                    await selectDocument(doc.document_id);
                }
                if (typeof showAnalyzerResultState === 'function') {
                    showAnalyzerResultState();
                }
            } catch (error) {
                console.error('Error loading document:', error);
                if (typeof showAnalyzerInitialState === 'function') {
                    showAnalyzerInitialState();
                }
                alert('Failed to load document. Please try again.');
            }
        });
        presavedList.appendChild(presavedItem);
    });
}

// Function to poll document status - OPTIMIZED: Increased interval and stop when all complete
function pollDocumentStatus() {
    // Clear any existing polling interval
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
    
    // Don't start polling if already running
    if (pollingInterval) return;
    
    pollingInterval = setInterval(async () => {
        try {
            const getAuthHeaders = window.getAuthHeaders || (() => ({}));
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
                    // CRITICAL FIX: Don't call updateDocumentView with incomplete data from list endpoint
                    // The list endpoint only returns metadata (no processed data like detected_chunks, document_markdown)
                    // Calling updateDocumentView with incomplete data overwrites the full document view
                    // Instead, only update status messages and fetch full data if status changed to complete
                    
                    // Track previous status to detect changes
                    const previousStatus = window.lastDocumentStatus || {};
                    const statusChanged = previousStatus[selectedDocumentId] !== selectedDoc.status;
                    previousStatus[selectedDocumentId] = selectedDoc.status;
                    window.lastDocumentStatus = previousStatus;
                    
                    // Only fetch full document data if:
                    // 1. Status changed to "complete" (processing just finished)
                    // 2. We don't already have full data loaded for this document
                    const hasFullData = window.lastFullDocumentData && 
                                      window.lastFullDocumentData[selectedDocumentId] &&
                                      window.lastFullDocumentData[selectedDocumentId].detected_chunks;
                    
                    if (statusChanged && selectedDoc.status === 'complete' && !hasFullData) {
                        // Status just changed to complete - fetch full document data
                        console.log('Document status changed to complete, fetching full data...');
                        try {
                            const getAuthHeaders = window.getAuthHeaders || (() => ({}));
                            const fullDocResponse = await fetch(`${API_BASE_URL}/documents/${selectedDocumentId}`, {
                                credentials: 'include',
                                headers: getAuthHeaders()
                            });
                            
                            if (fullDocResponse.ok) {
                                const fullDocData = await fullDocResponse.json();
                                // Store full data
                                if (!window.lastFullDocumentData) window.lastFullDocumentData = {};
                                window.lastFullDocumentData[selectedDocumentId] = fullDocData;
                                
                                // Now update view with complete data
                                if (typeof updateDocumentView === 'function') {
                                    updateDocumentView(fullDocData);
                                }
                                // Render preview with bounding boxes
                                if (typeof renderDocumentPreview === 'function') {
                                    renderDocumentPreview(fullDocData);
                                }
                                
                                // Auto-open PDF in new tab when document is ready
                                if (fullDocData.filename && (fullDocData.filename.toLowerCase().endsWith('.pdf') || fullDocData.file_type === 'pdf')) {
                                    setTimeout(() => {
                                        if (typeof openPdfInNewTab === 'function') {
                                            openPdfInNewTab(selectedDocumentId, fullDocData.filename);
                                        }
                                    }, 1000); // Small delay to let UI update
                                }
                            }
                        } catch (error) {
                            console.error('Error fetching full document data:', error);
                        }
                    } else if (hasFullData && selectedDoc.status === 'complete') {
                        // We already have full data loaded - don't overwrite it
                        // Just ensure the view is still showing the full data
                        const fullDocData = window.lastFullDocumentData[selectedDocumentId];
                        if (fullDocData && typeof updateDocumentView === 'function') {
                            // Only update if view seems to be missing data
                            const markdownView = document.getElementById('markdown-view');
                            if (!markdownView || !markdownView.innerHTML || markdownView.innerHTML.includes('No parsed data')) {
                                updateDocumentView(fullDocData);
                            }
                        }
                    }
                    
                    // Update upload status message (this is safe - only updates status banner)
                    const statusElement = document.getElementById('upload-status');
                    if (statusElement && selectedDoc.status === 'processing') {
                        statusElement.innerHTML = '<div class="status-banner processing">Processing document... This may take a moment.</div>';
                    } else if (statusElement && selectedDoc.status === 'complete' && statusChanged) {
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
    }, 5000); // OPTIMIZED: Poll every 5 seconds instead of 2 (reduces load by 60%)
}

// Function to select a document
async function selectDocument(documentId) {
    selectedDocumentId = documentId;
    
    // Save selected document ID to state
    if (typeof saveAnalyzerState === 'function') {
        saveAnalyzerState();
    }
    
    // If we're in initial state, show loading first
    const getAnalyzerState = window.getAnalyzerState || (() => 'initial');
    if (getAnalyzerState() === 'initial') {
        if (typeof showAnalyzerLoadingState === 'function') {
            showAnalyzerLoadingState();
        }
    }
    
    // OPTIMIZED: Don't restart polling if already running - just let it continue
    // Only restart if polling is not active
    if (!pollingInterval) {
        pollDocumentStatus();
    }
    
    // Highlight the selected document
    document.querySelectorAll('.document-item').forEach(item => {
        item.classList.remove('active');
        
        if (item.dataset.id === documentId) {
            item.classList.add('active');
        }
    });
    
    try {
        const getAuthHeaders = window.getAuthHeaders || (() => ({}));
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
        
        // Store full document data to prevent polling from overwriting it
        window.lastFullDocumentData = window.lastFullDocumentData || {};
        window.lastFullDocumentData[documentId] = document;
        
        // Update document view with full data (this also handles PDF rendering)
        if (typeof updateDocumentView === 'function') {
            updateDocumentView(document);
        }
        
        // Note: renderDocumentPreview is already called by updateDocumentView, so no need to call it again here
        
        // Clear chat messages and show example prompts
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
            chatMessages.style.display = 'none';
        }
        if (typeof updateExamplePrompts === 'function') {
            updateExamplePrompts(document);
        }
        
        // Determine the correct state based on document status
        if (document.status === 'complete' && document.detected_chunks) {
            // Document is complete - show result state
            if (typeof showAnalyzerResultState === 'function') {
                showAnalyzerResultState();
            }
        } else if (document.status === 'processing') {
            // Document is still processing - keep loading state
            if (typeof showAnalyzerLoadingState === 'function') {
                showAnalyzerLoadingState();
            }
        } else if (document.status === 'error') {
            // Document has error - show initial state
            if (typeof showAnalyzerInitialState === 'function') {
                showAnalyzerInitialState();
            }
        } else {
            // Default: if we have data, show result, otherwise keep loading
            if (document.detected_chunks && document.detected_chunks.length > 0) {
                if (typeof showAnalyzerResultState === 'function') {
                    showAnalyzerResultState();
                }
            } else if (getAnalyzerState() === 'loading') {
                // Keep loading state if we're already in loading
                if (typeof showAnalyzerLoadingState === 'function') {
                    showAnalyzerLoadingState();
                }
            }
        }
    } catch (error) {
        console.error('Error loading document details:', error);
        const documentView = document.getElementById('document-view');
        if (documentView) {
            documentView.innerHTML = `<div class="status-banner error">Error loading document details: ${error.message}</div>`;
        }
        
        // If error occurred during loading, go back to initial state
        if (getAnalyzerState() === 'loading') {
            if (typeof showAnalyzerInitialState === 'function') {
                showAnalyzerInitialState();
            }
        }
    }
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
    
    // Show loading state
    if (typeof showAnalyzerLoadingState === 'function') {
        showAnalyzerLoadingState();
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    currentUploadStatus.innerHTML = '<div class="status-banner processing">Uploading document...</div>';
    
    try {
        const headers = {};
        const getAuthToken = window.getAuthToken || (() => null);
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
            let errorMessage = 'Failed to upload document';
            try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.error || errorMessage;
            } catch (e) {
                errorMessage = `Upload failed: ${response.status} ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        // Update status
        currentUploadStatus.innerHTML = '<div class="status-banner processing">Document uploaded. Processing with Landing.AI...</div>';
        
        // Auto-select the uploaded document
        if (data.document_id) {
            selectedDocumentId = data.document_id;
        }
        
        // Clear the file input
        currentFileInput.value = '';
        
        // Wait for processing to complete
        const processedDoc = await waitForProcessing(data.document_id, true);
        
        // Clear upload status
        if (currentUploadStatus) {
            currentUploadStatus.innerHTML = '';
        }
        
        // Load the document
        await selectDocument(data.document_id);
        
        // Show result state
        if (typeof showAnalyzerResultState === 'function') {
            showAnalyzerResultState();
        }
        
        // Start polling for document status
        pollDocumentStatus();
        
        // Load documents again to update the list (will only show 3 most recent)
        loadDocuments();
        
    } catch (error) {
        console.error('Error uploading document:', error);
        
        // Show error state
        if (typeof showAnalyzerInitialState === 'function') {
            showAnalyzerInitialState();
        }
        
        // Show detailed error message
        let errorMessage = 'Failed to upload document.';
        if (error.message) {
            errorMessage = error.message;
        }
        
        // Check if it's a network error
        if (error.message && error.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        const errorUploadStatus = document.getElementById('upload-status');
        if (errorUploadStatus) {
            errorUploadStatus.innerHTML = `<div class="status-banner error">${errorMessage}</div>`;
        }
    }
}

// Initialize analyzer functionality
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
        // Remove existing listeners to prevent duplicates
        const newBackBtn = backBtn.cloneNode(true);
        backBtn.parentNode.replaceChild(newBackBtn, backBtn);
        
        newBackBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Ensure analyzer section is visible first
            const analyzerSection = document.getElementById('analyzer-section');
            if (analyzerSection) {
                analyzerSection.style.display = 'block';
            }
            
            // Clear the selected document from state first
            if (typeof setSelectedDocumentId === 'function') {
                setSelectedDocumentId(null);
            }
            selectedDocumentId = null;
            
            // Clear document view content
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
            
            // Clear saved state since user explicitly went back
            if (typeof clearAnalyzerState === 'function') {
                clearAnalyzerState();
            }
            
            // Show initial state - this must be called last to ensure proper display
            if (typeof showAnalyzerInitialState === 'function') {
                showAnalyzerInitialState();
            }
            
            // Force a small delay to ensure DOM updates, then reload pre-saved documents
            setTimeout(() => {
                // Reload pre-saved documents to refresh the list
                if (typeof loadPresavedDocuments === 'function') {
                    loadPresavedDocuments();
                }
                
                // Double-check everything is visible
                const initialState = document.getElementById('analyzer-initial-state');
                if (initialState) {
                    initialState.style.display = 'block';
                    initialState.style.visibility = 'visible';
                    initialState.style.opacity = '1';
                }
                
                // Ensure analyzer section is still visible
                if (analyzerSection) {
                    analyzerSection.style.display = 'block';
                }
            }, 100);
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
            if (typeof showAnalyzerLoadingState === 'function') {
                showAnalyzerLoadingState();
            }
            await processFileUpload(file, action);
        }
    }, { once: true });
    
    fileInput.click();
}

async function processFileUpload(file, action) {
    // Show loading state immediately
    if (typeof showAnalyzerLoadingState === 'function') {
        showAnalyzerLoadingState();
    }
    
    // Show upload status
    const uploadStatus = document.getElementById('upload-status');
    if (uploadStatus) {
        uploadStatus.innerHTML = '<div class="status-banner processing">Uploading document...</div>';
    }
    
    try {
        const formData = new FormData();
        formData.append('file', file);
        
        // Get auth headers but remove Content-Type for FormData (browser sets it automatically)
        const getAuthHeaders = window.getAuthHeaders || (() => ({}));
        const authHeaders = getAuthHeaders();
        delete authHeaders['Content-Type'];
        
        // Update status
        if (uploadStatus) {
            uploadStatus.innerHTML = '<div class="status-banner processing">Uploading to server...</div>';
        }
        
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
            
            // Handle duplicate document error (409)
            if (response.status === 409) {
                // Show error and return to initial state
                if (typeof showAnalyzerInitialState === 'function') {
                    showAnalyzerInitialState();
                }
                const errorUploadStatus = document.getElementById('upload-status');
                if (errorUploadStatus) {
                    errorUploadStatus.innerHTML = `<div class="status-banner error">${errorMessage}</div>`;
                }
                return; // Don't throw, just return
            }
            
            throw new Error(errorMessage);
        }
        
        const data = await response.json();
        
        if (!data.document_id) {
            throw new Error('No document ID returned from server');
        }
        
        // Update status to show processing
        if (uploadStatus) {
            uploadStatus.innerHTML = '<div class="status-banner processing">Document uploaded. Processing with Landing.AI...</div>';
        }
        
        // Wait for processing to complete
        const processedDoc = await waitForProcessing(data.document_id, true);
        
        // Clear upload status
        if (uploadStatus) {
            uploadStatus.innerHTML = '';
        }
        
        // Load the document
        await selectDocument(data.document_id);
        
        // Show result state
        if (typeof showAnalyzerResultState === 'function') {
            showAnalyzerResultState();
        }
        
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
        
        // Show error state
        if (typeof showAnalyzerInitialState === 'function') {
            showAnalyzerInitialState();
        }
        
        // Show detailed error message
        let errorMessage = 'Failed to upload document.';
        if (error.message) {
            errorMessage = error.message;
        }
        
        // Check if it's a network error
        if (error.message && error.message.includes('fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        // Show error in upload status
        if (uploadStatus) {
            uploadStatus.innerHTML = `<div class="status-banner error">${errorMessage}</div>`;
        } else {
            // Fallback to alert if upload status element not found
            alert(errorMessage);
        }
    }
}

async function waitForProcessing(documentId, checkInDatabase = true) {
    const maxAttempts = 120; // 120 seconds max (2 minutes) for Landing.AI processing
    let attempts = 0;
    
    // Loading state is handled by spinner - no text updates needed
    const uploadStatus = document.getElementById('upload-status');
    
    while (attempts < maxAttempts) {
        try {
            // Loading spinner handles the visual feedback
            // No text or percentage updates needed
            
            // Check document status
            const getAuthHeaders = window.getAuthHeaders || (() => ({}));
            const response = await fetch(`${API_BASE_URL}/documents/${documentId}`, {
                credentials: 'include',
                headers: getAuthHeaders()
            });
            
            // Handle 401 - redirect to login
            if (response.status === 401) {
                window.location.href = '/login';
                return;
            }
            
            // If document not in database (404), it might be session-only
            // For session-only documents, we'll check status endpoint or wait a bit longer
            if (response.status === 404 && !checkInDatabase) {
                // Session-only document - wait a bit longer then try to get processed data
                if (attempts >= 30) { // After 30 seconds, assume processing might be done
                    // Try to get document anyway (it might be processed)
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return; // Exit and let the caller handle loading
                }
            } else if (response.ok) {
                const data = await response.json();
                if (data.status === 'complete') {
                    // Loading spinner continues until result state is shown
                    // Auto-open PDF in new tab when document is ready
                    if (data.filename && (data.filename.toLowerCase().endsWith('.pdf') || data.file_type === 'pdf')) {
                        setTimeout(() => {
                            if (typeof openPdfInNewTab === 'function') {
                                openPdfInNewTab(data.document_id, data.filename);
                            }
                        }, 1500); // Delay to let UI update first
                    }
                    return data; // Return document data
                } else if (data.status === 'error') {
                    throw new Error(data.status_message || 'Document processing failed');
                }
            }
        } catch (error) {
            // If it's a 404 and we're not checking database, that's expected for session-only docs
            if (error.message && error.message.includes('404') && !checkInDatabase) {
                // Continue waiting
            } else {
                console.error('Error checking status:', error);
            }
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
    }
    
    // If we get here, processing took too long
    // Loading spinner continues - user sees spinner while waiting
    
    // Don't throw error - just return null and let caller handle
    console.warn('Processing timeout - document may still be processing');
    return null;
}

function loadPresavedDocuments() {
    // Load documents from API and populate the pre-saved docs list
    loadDocuments().then(() => {
        // updatePresavedDocuments will be called from displayDocuments
    });
}

// Export functions
window.loadDocuments = loadDocuments;
window.displayDocuments = displayDocuments;
window.selectDocument = selectDocument;
window.uploadDocument = uploadDocument;
window.pollDocumentStatus = pollDocumentStatus;
window.initializeAnalyzer = initializeAnalyzer;
window.handleActionCardUpload = handleActionCardUpload;
window.processFileUpload = processFileUpload;
/**
 * Open PDF in new tab with download capability
 * @param {string} documentId - Document ID
 * @param {string} filename - Document filename
 */
function openPdfInNewTab(documentId, filename) {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        
        // Create PDF viewer URL
        const pdfUrl = `${apiBase}/documents/${documentId}/file`;
        
        // Create a new window with PDF viewer
        const pdfWindow = window.open('', '_blank');
        
        if (pdfWindow) {
            // Create HTML page with embedded PDF viewer and download button
            const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${filename || 'Document Viewer'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f7fa;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .pdf-header {
            background: linear-gradient(135deg, #059669 0%, #10b981 100%);
            color: white;
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            z-index: 1000;
        }
        .pdf-header h1 {
            font-size: 1.2rem;
            font-weight: 600;
            margin: 0;
        }
        .pdf-header-actions {
            display: flex;
            gap: 12px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-download {
            background: white;
            color: #059669;
        }
        .btn-download:hover {
            background: #f0fdf4;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .btn-close {
            background: rgba(255, 255, 255, 0.2);
            color: white;
        }
        .btn-close:hover {
            background: rgba(255, 255, 255, 0.3);
        }
        .pdf-container {
            flex: 1;
            overflow: auto;
            background: #525252;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 20px;
        }
        .pdf-container iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: white;
            gap: 16px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="pdf-header">
        <h1>📄 ${filename || 'Document Viewer'}</h1>
        <div class="pdf-header-actions">
            <button class="btn btn-download" onclick="downloadPdf()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download PDF
            </button>
            <button class="btn btn-close" onclick="window.close()">Close</button>
        </div>
    </div>
    <div class="pdf-container">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading PDF...</p>
        </div>
    </div>
    <script>
        const pdfUrl = '${pdfUrl}';
        const filename = '${filename || 'document.pdf'}';
        const token = localStorage.getItem('access_token') || '';
        
        // Load PDF in iframe with authentication
        function loadPdf() {
            const container = document.querySelector('.pdf-container');
            // Use iframe with blob URL for better compatibility
            fetch(pdfUrl, {
                credentials: 'include',
                headers: {
                    'Authorization': token ? 'Bearer ' + token : ''
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to load PDF');
                return response.blob();
            })
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                container.innerHTML = '<iframe src="' + blobUrl + '" type="application/pdf"></iframe>';
            })
            .catch(error => {
                console.error('Error loading PDF:', error);
                container.innerHTML = '<div style="color: white; text-align: center; padding: 40px;"><p>Unable to load PDF.</p><p><a href="' + pdfUrl + '" download style="color: white; text-decoration: underline;">Download instead</a></p></div>';
            });
        }
        
        // Download PDF
        function downloadPdf() {
            fetch(pdfUrl, {
                credentials: 'include',
                headers: {
                    'Authorization': token ? 'Bearer ' + token : ''
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to download PDF');
                return response.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            })
            .catch(error => {
                console.error('Download error:', error);
                alert('Failed to download PDF. Please try again.');
            });
        }
        
        // Load PDF when page loads
        window.addEventListener('load', () => {
            setTimeout(loadPdf, 100);
        });
    </script>
</body>
</html>
            `;
            
            pdfWindow.document.write(htmlContent);
            pdfWindow.document.close();
            pdfWindow.focus();
        } else {
            // Popup blocked - show notification
            console.warn('Popup blocked. PDF will not open automatically.');
        }
    } catch (error) {
        console.error('Error opening PDF in new tab:', error);
    }
}

/**
 * Open PDF in new tab with download capability
 * @param {string} documentId - Document ID
 * @param {string} filename - Document filename
 */
function openPdfInNewTab(documentId, filename) {
    try {
        const apiBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
        
        // Create PDF viewer URL
        const pdfUrl = `${apiBase}/documents/${documentId}/file`;
        
        // Create a new window with PDF viewer
        const pdfWindow = window.open('', '_blank');
        
        if (pdfWindow) {
            // Create HTML page with embedded PDF viewer and download button
            const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${filename || 'Document Viewer'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: #f5f7fa;
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .pdf-header {
            background: linear-gradient(135deg, #059669 0%, #10b981 100%);
            color: white;
            padding: 16px 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            z-index: 1000;
        }
        .pdf-header h1 {
            font-size: 1.2rem;
            font-weight: 600;
            margin: 0;
        }
        .pdf-header-actions {
            display: flex;
            gap: 12px;
        }
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .btn-download {
            background: white;
            color: #059669;
        }
        .btn-download:hover {
            background: #f0fdf4;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .btn-close {
            background: rgba(255, 255, 255, 0.2);
            color: white;
        }
        .btn-close:hover {
            background: rgba(255, 255, 255, 0.3);
        }
        .pdf-container {
            flex: 1;
            overflow: auto;
            background: #525252;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 20px;
        }
        .pdf-container iframe {
            width: 100%;
            height: 100%;
            border: none;
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        .loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: white;
            gap: 16px;
        }
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="pdf-header">
        <h1>📄 ${filename || 'Document Viewer'}</h1>
        <div class="pdf-header-actions">
            <button class="btn btn-download" onclick="downloadPdf()">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download PDF
            </button>
            <button class="btn btn-close" onclick="window.close()">Close</button>
        </div>
    </div>
    <div class="pdf-container">
        <div class="loading">
            <div class="spinner"></div>
            <p>Loading PDF...</p>
        </div>
    </div>
    <script>
        const pdfUrl = '${pdfUrl}';
        const filename = '${filename || 'document.pdf'}';
        const token = localStorage.getItem('access_token') || '';
        
        // Load PDF in iframe with authentication
        function loadPdf() {
            const container = document.querySelector('.pdf-container');
            // Use iframe with blob URL for better compatibility
            fetch(pdfUrl, {
                credentials: 'include',
                headers: {
                    'Authorization': token ? 'Bearer ' + token : ''
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to load PDF');
                return response.blob();
            })
            .then(blob => {
                const blobUrl = URL.createObjectURL(blob);
                container.innerHTML = '<iframe src="' + blobUrl + '" type="application/pdf"></iframe>';
            })
            .catch(error => {
                console.error('Error loading PDF:', error);
                container.innerHTML = '<div style="color: white; text-align: center; padding: 40px;"><p>Unable to load PDF.</p><p><a href="' + pdfUrl + '" download style="color: white; text-decoration: underline;">Download instead</a></p></div>';
            });
        }
        
        // Download PDF
        function downloadPdf() {
            fetch(pdfUrl, {
                credentials: 'include',
                headers: {
                    'Authorization': token ? 'Bearer ' + token : ''
                }
            })
            .then(response => {
                if (!response.ok) throw new Error('Failed to download PDF');
                return response.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            })
            .catch(error => {
                console.error('Download error:', error);
                alert('Failed to download PDF. Please try again.');
            });
        }
        
        // Load PDF when page loads
        window.addEventListener('load', () => {
            setTimeout(loadPdf, 100);
        });
    </script>
</body>
</html>
            `;
            
            pdfWindow.document.write(htmlContent);
            pdfWindow.document.close();
            pdfWindow.focus();
        } else {
            // Popup blocked - show notification
            console.warn('Popup blocked. PDF will not open automatically.');
        }
    } catch (error) {
        console.error('Error opening PDF in new tab:', error);
    }
}

window.waitForProcessing = waitForProcessing;
window.loadPresavedDocuments = loadPresavedDocuments;
window.getSelectedDocumentId = () => selectedDocumentId;
window.setSelectedDocumentId = (id) => { selectedDocumentId = id; };
window.openPdfInNewTab = openPdfInNewTab;

