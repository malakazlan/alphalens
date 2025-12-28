// Chat Module
// Handles chat functionality, message sending, and example prompts

// Ensure API_BASE_URL and dependencies are available
if (typeof API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// Function to send a chat message
async function sendChatMessage() {
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const chatSendButton = document.getElementById('chat-send');
    const escapeHtml = window.escapeHtml || ((t) => t);
    const renderMarkdown = window.renderMarkdown || ((t) => escapeHtml(t));
    const renderCitationChips = window.renderCitationChips || (() => '');
    const getAuthHeaders = window.getAuthHeaders || (() => ({}));
    const getSelectedDocumentId = window.getSelectedDocumentId || (() => null);
    
    if (!chatInput || !chatMessages) return;
    
    const query = chatInput.value.trim();
    
    if (!query) {
        return;
    }
    
    const selectedDocumentId = getSelectedDocumentId();
    if (!selectedDocumentId) {
        // Show chat messages area
        chatMessages.style.display = 'flex';
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
    chatMessages.style.display = 'flex';
    
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
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.value = prompt;
                chatInput.focus();
            }
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

function attachCitationHandlers() {
    const highlightChunk = window.highlightChunk || (() => {});
    const highlightPdfRegion = window.highlightPdfRegion || (() => {});
    const scrollToMarkdownSection = window.scrollToMarkdownSection || (() => {});
    const renderAllPdfPages = window.renderAllPdfPages || (() => {});
    const getPdfDocInstance = window.getPdfDocInstance || (() => null);
    
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
                const pdfDocInstance = getPdfDocInstance();
                if (pdfDocInstance && pageNum <= pdfDocInstance.numPages) {
                    renderAllPdfPages(); // Re-render to show the page
                }
            }
        });
    });
}

function clearVisualReferences() {
    const highlightChunk = window.highlightChunk || (() => {});
    const highlightPdfRegion = window.highlightPdfRegion || (() => {});
    
    // Remove all highlights
    highlightChunk(null);
    highlightPdfRegion(null);
    
    // Remove active state from all visual reference items
    document.querySelectorAll('.visual-reference-item').forEach(item => {
        item.classList.remove('active');
    });
}

// Export functions
window.sendChatMessage = sendChatMessage;
window.updateExamplePrompts = updateExamplePrompts;
window.attachCitationHandlers = attachCitationHandlers;
window.clearVisualReferences = clearVisualReferences;

