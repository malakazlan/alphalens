// Chat Module
// Handles chat functionality, message sending, and example prompts

// Ensure API_BASE_URL and dependencies are available
if (typeof window.API_BASE_URL === 'undefined') {
    window.API_BASE_URL = window.location.origin;
}

// Function to send a chat message
async function sendChatMessage() {
    console.log('=== sendChatMessage CALLED ===');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const chatSendButton = document.getElementById('chat-send');
    
    console.log('Chat elements:', { chatInput: !!chatInput, chatMessages: !!chatMessages, chatSendButton: !!chatSendButton });
    
    if (!chatInput || !chatMessages) {
        console.error('Chat input or messages element not found');
        return;
    }
    
    const query = chatInput.value.trim();
    console.log('Query:', query);
    
    if (!query) {
        console.log('Empty query, returning');
        return;
    }
    
    const escapeHtml = window.escapeHtml || ((t) => t);
    const renderMarkdown = window.renderMarkdown || ((t) => escapeHtml(t));
    const renderCitationChips = window.renderCitationChips || (() => '');
    const getAuthHeaders = window.getAuthHeaders || (() => ({}));
    const getSelectedDocumentId = window.getSelectedDocumentId || (() => null);
    
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
        const apiBaseUrl = window.API_BASE_URL || window.location.origin;
        console.log('Sending request to:', `${apiBaseUrl}/documents/chat`);
        const response = await fetch(`${apiBaseUrl}/documents/chat`, {
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
            } else if (data.source === 'trend_analysis') {
                sourceClass = 'source-trend';
                sourceText = 'Trend Analysis';
            } else if (data.source === 'comparison_analysis') {
                sourceClass = 'source-comparison';
                sourceText = 'Comparison';
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
        
        // Build follow-up suggestions HTML (Landing.AI style)
        let followUpHtml = '';
        if (data.follow_up_suggestions && data.follow_up_suggestions.length > 0) {
            followUpHtml = '<div class="follow-up-suggestions"><div class="follow-up-title">Suggested follow-ups:</div>';
            data.follow_up_suggestions.slice(0, 3).forEach(suggestion => {
                followUpHtml += `<button class="follow-up-btn" data-query="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`;
            });
            followUpHtml += '</div>';
        }
        
        // Remove typing indicator
        const typingIndicatorEl = chatMessages.querySelector('.typing-indicator');
        if (typingIndicatorEl) {
            typingIndicatorEl.remove();
        }
        
        responseMessage.innerHTML = `
            ${answerHtml}
            ${sourceText ? `<span class="source-tag ${sourceClass}">${sourceText}</span>` : ''}
            ${citationHtml}
            ${followUpHtml}
        `;
        chatMessages.appendChild(responseMessage);
        attachCitationHandlers();
        attachFollowUpHandlers();
        
        // Re-enable send button
        if (chatSendButton) {
            chatSendButton.disabled = false;
        }
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error getting answer:', error);
        
        // Remove typing indicator
        const typingIndicatorEl = chatMessages.querySelector('.typing-indicator');
        if (typingIndicatorEl) {
            typingIndicatorEl.remove();
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

// Function to generate intelligent example prompts based on detected chunks (Landing.AI style)
function updateExamplePrompts(docData) {
    const examplePromptsList = document.getElementById('example-prompts-list');
    const examplePromptsSection = document.getElementById('example-prompts-section');
    
    if (!examplePromptsList || !examplePromptsSection) return;
    
    // Clear existing prompts
    examplePromptsList.innerHTML = '';
    
    // Generate intelligent prompts based on detected chunks
    const prompts = [];
    
    if (docData && docData.detected_chunks && docData.detected_chunks.length > 0) {
        const chunks = docData.detected_chunks || [];
        const markdown = docData.document_markdown || '';
        const markdownLower = markdown.toLowerCase();
        
        // Analyze chunk types to generate context-aware prompts
        const chunkTypes = new Set();
        const tableChunks = [];
        const textChunks = [];
        const marginaliaChunks = [];
        
        chunks.forEach(chunk => {
            const chunkType = (chunk.type || 'text').toLowerCase();
            chunkTypes.add(chunkType);
            
            if (chunkType === 'table') {
                tableChunks.push(chunk);
            } else if (chunkType === 'text') {
                textChunks.push(chunk);
            } else if (chunkType === 'marginalia') {
                marginaliaChunks.push(chunk);
            }
        });
        
        // Extract key information from chunks
        let extractedName = '';
        let extractedAmount = '';
        let extractedDate = '';
        let extractedBank = '';
        let extractedAccount = '';
        
        // Analyze text chunks for key information
        textChunks.forEach(chunk => {
            const chunkText = (chunk.text || chunk.markdown || '').toLowerCase();
            
            // Extract name patterns
            if (!extractedName) {
                const namePatterns = [
                    /(?:name|student|customer|registrant)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i,
                    /^([A-Z][a-z]+\s+[A-Z][a-z]+)/,
                ];
                for (const pattern of namePatterns) {
                    const match = chunkText.match(pattern);
                    if (match && match[1]) {
                        extractedName = match[1];
                        break;
                    }
                }
            }
            
            // Extract amount patterns
            if (!extractedAmount) {
                const amountPatterns = [
                    /(?:total|amount|due|balance)[:\s]*([\d,]+(?:\.\d+)?)/i,
                    /(?:rs\.?|pkr|usd|\$)[:\s]*([\d,]+(?:\.\d+)?)/i,
                ];
                for (const pattern of amountPatterns) {
                    const match = chunkText.match(pattern);
                    if (match && match[1]) {
                        extractedAmount = match[1];
                        break;
                    }
                }
            }
            
            // Extract date patterns
            if (!extractedDate) {
                const datePatterns = [
                    /(?:due date|date|issued|dated)[:\s]+([A-Z][a-z]+\s+\d{1,2},?\s+\d{4})/i,
                    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
                ];
                for (const pattern of datePatterns) {
                    const match = chunkText.match(pattern);
                    if (match && match[1]) {
                        extractedDate = match[1];
                        break;
                    }
                }
            }
            
            // Extract bank information
            if (!extractedBank) {
                const bankMatch = chunkText.match(/(?:bank|financial institution)[:\s]+([A-Z][A-Z\s&]+)/i);
                if (bankMatch && bankMatch[1]) {
                    extractedBank = bankMatch[1].trim();
                }
            }
            
            // Extract account number
            if (!extractedAccount) {
                const accountMatch = chunkText.match(/(?:account|a\/c|acct)[:\s#]*([\d\-]+)/i);
                if (accountMatch && accountMatch[1]) {
                    extractedAccount = accountMatch[1];
                }
            }
        });
        
        // Generate context-aware prompts based on detected content
        
        // 1. Amount-related prompts
        if (extractedAmount || markdownLower.includes('total') || markdownLower.includes('amount') || markdownLower.includes('due')) {
            if (extractedName) {
                prompts.push(`What is the total amount due for ${extractedName}?`);
            } else {
                prompts.push('What is the total amount due?');
            }
        }
        
        // 2. Date-related prompts
        if (extractedDate || markdownLower.includes('date') || markdownLower.includes('due date')) {
            prompts.push('What is the due date for payment?');
        }
        
        // 3. Table-related prompts (if tables detected)
        if (tableChunks.length > 0) {
            prompts.push(`What information is in the ${tableChunks.length === 1 ? 'table' : 'tables'}?`);
        }
        
        // 4. Bank/Account prompts
        if (extractedBank || extractedAccount || markdownLower.includes('bank') || markdownLower.includes('account')) {
            if (extractedBank && extractedAccount) {
                prompts.push(`What are the payment details for ${extractedBank}?`);
            } else {
                prompts.push('Which bank and account number should be used for payment?');
            }
        }
        
        // 5. Summary prompt (always useful)
        if (chunks.length > 5) {
            prompts.push('Can you summarize the key information in this document?');
        }
        
        // 6. Document type-specific prompts
        if (markdownLower.includes('invoice') || markdownLower.includes('bill')) {
            prompts.push('What are the invoice details?');
        } else if (markdownLower.includes('statement')) {
            prompts.push('What does this statement show?');
        } else if (markdownLower.includes('certificate') || markdownLower.includes('certificat')) {
            prompts.push('What information is on this certificate?');
        }
    }
    
    // If no specific prompts generated, use intelligent generic ones
    if (prompts.length === 0) {
        prompts.push('What is the main information in this document?');
        prompts.push('Can you summarize the key details?');
    }
    
    // Limit to 3-4 most relevant prompts (Landing.AI shows multiple suggestions)
    const displayPrompts = prompts.slice(0, 4);
    
    // Create prompt elements with better styling
    displayPrompts.forEach((prompt, index) => {
        const promptElement = document.createElement('div');
        promptElement.className = 'example-prompt';
        promptElement.setAttribute('role', 'button');
        promptElement.setAttribute('tabindex', '0');
        promptElement.textContent = prompt;
        
        // Add click handler
        promptElement.addEventListener('click', () => {
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.value = prompt;
                chatInput.focus();
                // Optionally auto-send (or let user review first)
            }
        });
        
        // Add keyboard support
        promptElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                promptElement.click();
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

// Attach handlers for follow-up suggestion buttons
function attachFollowUpHandlers() {
    document.querySelectorAll('.follow-up-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const query = btn.dataset.query;
            if (query) {
                const chatInput = document.getElementById('chat-input');
                if (chatInput) {
                    chatInput.value = query;
                    chatInput.focus();
                    // Optionally auto-send
                    // sendChatMessage();
                }
            }
        });
    });
}

// ============================================
// EXPORT FUNCTIONS IMMEDIATELY
// ============================================
window.sendChatMessage = sendChatMessage;
window.updateExamplePrompts = updateExamplePrompts;
window.attachCitationHandlers = attachCitationHandlers;
window.clearVisualReferences = clearVisualReferences;
window.attachFollowUpHandlers = attachFollowUpHandlers;

// ============================================
// SHOW INITIAL GREETING (Landing.AI Style)
// ============================================
function showInitialGreeting() {
    const chatMessages = document.getElementById('chat-messages');
    const examplePromptsSection = document.getElementById('example-prompts-section');
    
    if (!chatMessages) return;
    
    // Check if greeting already exists
    if (chatMessages.querySelector('.message.response.greeting')) {
        return;
    }
    
    // Hide example prompts when greeting is shown
    if (examplePromptsSection) {
        examplePromptsSection.style.display = 'none';
    }
    
    // Show chat messages area
    chatMessages.style.display = 'flex';
    
    // Create greeting message
    const greetingMessage = document.createElement('div');
    greetingMessage.className = 'message response greeting';
    greetingMessage.innerHTML = '<div>Hello! How can I assist you today?</div>';
    chatMessages.appendChild(greetingMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================
// INITIALIZE CHAT BUTTON - SIMPLE & DIRECT
// ============================================
function setupChatButton() {
    const chatSendBtn = document.getElementById('chat-send');
    const chatInputField = document.getElementById('chat-input');
    
    if (!chatSendBtn) {
        console.warn('Chat send button not found');
        return false;
    }
    
    if (!chatInputField) {
        console.warn('Chat input field not found');
        return false;
    }
    
    // Remove any existing onclick to avoid duplicates
    chatSendBtn.onclick = null;
    
    // Set up button click handler
    chatSendBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('✅ CHAT SEND BUTTON CLICKED');
        
        if (window.sendChatMessage && typeof window.sendChatMessage === 'function') {
            window.sendChatMessage();
        } else {
            console.error('❌ sendChatMessage not available');
            alert('Chat function not loaded. Please refresh the page.');
        }
    }, { once: false });
    
    // Set up Enter key handler
    chatInputField.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            console.log('✅ ENTER PRESSED IN CHAT INPUT');
            if (window.sendChatMessage && typeof window.sendChatMessage === 'function') {
                window.sendChatMessage();
            }
        }
    }, { once: false });
    
    // Ensure button is enabled
    chatSendBtn.disabled = false;
    chatSendBtn.style.pointerEvents = 'auto';
    chatSendBtn.style.cursor = 'pointer';
    
    console.log('✅ Chat button initialized successfully');
    return true;
}

// Export functions
window.initializeChatButton = setupChatButton;
window.showInitialGreeting = showInitialGreeting;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(setupChatButton, 100);
        setTimeout(setupChatButton, 500);
    });
} else {
    setTimeout(setupChatButton, 100);
    setTimeout(setupChatButton, 500);
}
