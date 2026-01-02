// Content Module
// Handles markdown formatting, content display, and document view updates

// Ensure dependencies are available
if (typeof escapeHtml === 'undefined' && typeof window.escapeHtml === 'function') {
    window.escapeHtml = window.escapeHtml;
}
if (typeof formatValue === 'undefined' && typeof window.formatValue === 'function') {
    window.formatValue = window.formatValue;
}
if (typeof formatBoundingBox === 'undefined' && typeof window.formatBoundingBox === 'function') {
    window.formatBoundingBox = window.formatBoundingBox;
}

// Convert markdown to HTML for chat messages (ChatGPT-like formatting)
function renderMarkdown(text) {
    if (!text) return '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    
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

// Format table HTML for display - render as actual HTML table
function formatTableHTML(tableHTML, textBeforeTable = '') {
    if (!tableHTML) return '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    
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

// Format markdown like Landing.AI - structured with numbered sections and proper table rendering
function formatMarkdownLikeLandingAI(docData) {
    let html = '';
    const markdown = docData.document_markdown || '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    const getNumberedLabel = window.getNumberedLabel || ((type, id) => type.toUpperCase());
    const resetCounters = window.resetCounters || (() => {});
    
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
        let sectionNumber = 1;
        
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

// Function to format JSON in a professional, structured way
function formatStructuredJSON(docData) {
    if (!docData) return '{}';
    
    // Build a clean, organized JSON structure
    const structured = {
        document: {
            id: docData.document_id || null,
            filename: docData.filename || null,
            status: docData.status || null,
            upload_time: docData.upload_time || null,
            file_type: docData.file_type || null,
            file_size: docData.file_size || null
        },
        metadata: {
            ...(docData.metadata || {}),
            page_count: docData.metadata?.page_count || null,
            processing_time: docData.metadata?.processing_time || null
        },
        content: {
            markdown: docData.document_markdown || '',
            markdown_length: (docData.document_markdown || '').length
        },
        chunks: (() => {
            const chunks = docData.detected_chunks || [];
            const byType = {};
            
            const items = chunks.map(chunk => {
                // Count by type
                const type = chunk.type || 'unknown';
                byType[type] = (byType[type] || 0) + 1;
                
                // Return clean chunk structure
                return {
                    id: chunk.chunk_id || null,
                    type: type,
                    page: chunk.page !== undefined ? chunk.page + 1 : null, // Convert to 1-based
                    text: chunk.text || chunk.markdown || '',
                    text_length: (chunk.text || chunk.markdown || '').length,
                    bounding_box: chunk.bounding_box || null,
                    confidence: chunk.confidence || null,
                    metadata: {
                        ...(chunk.metadata || {}),
                        visual_ref: chunk.visual_ref || null
                    }
                };
            });
            
            return {
                total: chunks.length,
                by_type: byType,
                items: items
            };
        })(),
        splits: {
            total: (docData.splits || []).length,
            items: (docData.splits || []).map(split => ({
                id: split.split_id || null,
                text: split.text || '',
                text_length: (split.text || '').length,
                chunk_ids: split.chunk_ids || [],
                metadata: split.metadata || {}
            }))
        },
        grounding: docData.grounding || {},
        processing: {
            status: docData.status || 'unknown',
            processed_at: docData.processed_at || null,
            processing_method: docData.processing_method || null
        }
    };
    
    // Remove null values and empty objects for cleaner output
    const cleanStructured = removeEmptyValues(structured);
    
    // Format with proper indentation and sorting
    return JSON.stringify(cleanStructured, (key, value) => {
        // Sort keys alphabetically for consistency
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            const sorted = {};
            Object.keys(value).sort().forEach(k => {
                sorted[k] = value[k];
            });
            return sorted;
        }
        return value;
    }, 2);
}

// Helper function to remove null/empty values for cleaner JSON
function removeEmptyValues(obj) {
    if (Array.isArray(obj)) {
        return obj.map(item => removeEmptyValues(item));
    } else if (obj && typeof obj === 'object') {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) {
                continue; // Skip null/undefined
            }
            if (typeof value === 'object' && Object.keys(value).length === 0) {
                continue; // Skip empty objects
            }
            if (Array.isArray(value) && value.length === 0) {
                continue; // Skip empty arrays
            }
            cleaned[key] = removeEmptyValues(value);
        }
        return cleaned;
    }
    return obj;
}

// Function to update document view
function updateDocumentView(docData) {
    console.log('Updating document view:', docData);
    
    // CRITICAL FIX: Don't overwrite view with incomplete data
    // Check if this is incomplete data (from list endpoint) vs complete data (from /documents/{id})
    const hasProcessedData = docData.document_markdown || docData.detected_chunks;
    const hasOnlyMetadata = docData.document_id && docData.filename && docData.status && !hasProcessedData;
    
    if (hasOnlyMetadata) {
        console.log('Skipping updateDocumentView - incomplete data (metadata only, no processed data)');
        // Only update status-related UI elements, not the full document view
        const selectedFileElement = document.getElementById('selected-file-name');
        if (selectedFileElement && docData.filename) {
            selectedFileElement.textContent = docData.filename;
        }
        return; // Don't overwrite existing view with incomplete data
    }
    
    const escapeHtml = window.escapeHtml || ((t) => t);
    const formatValue = window.formatValue || ((v, u) => v);
    const formatBoundingBox = window.formatBoundingBox || (() => '');
    const formatMarkdownLikeLandingAI = window.formatMarkdownLikeLandingAI || (() => '');
    
    // Update parse panel with markdown/JSON
    const markdownView = document.getElementById('markdown-view');
    const jsonView = document.getElementById('json-content');
    
    if (!markdownView || !jsonView) {
        console.error('Parse panel elements not found!', { markdownView, jsonView });
        return;
    }
    
    // Check if file or processed data is missing
    if (docData.file_missing || docData.processed_data_missing) {
        let errorMsg = '';
        if (docData.file_missing && docData.processed_data_missing) {
            errorMsg = '⚠️ This document\'s files were deleted from storage. The document is no longer available.';
        } else if (docData.file_missing) {
            errorMsg = '⚠️ The original file was deleted from storage. Processed data may still be available.';
        } else if (docData.processed_data_missing) {
            errorMsg = '⚠️ Processed data was deleted from storage. The document may need to be reprocessed.';
        }
        
        markdownView.innerHTML = `<div class="status-banner error" style="margin: 20px 0;">
            <p style="font-weight: 500; margin-bottom: 8px;">${errorMsg}</p>
            ${docData.error_message ? `<p style="font-size: 0.9rem; opacity: 0.9;">${docData.error_message}</p>` : ''}
        </div>`;
        jsonView.textContent = '';
        console.log('Document files missing from storage');
        return; // Don't continue with normal processing
    }
    
    if (docData.document_markdown) {
        // Format markdown like Landing.AI - structured with numbered sections
        const formattedMarkdown = formatMarkdownLikeLandingAI(docData);
        markdownView.innerHTML = formattedMarkdown;
        
        // Add click handlers to markdown sections for interactive region detection
        if (typeof setupMarkdownInteractivity === 'function') {
            setupMarkdownInteractivity();
        }
        
        // Show JSON in professional, structured format
        const structuredJson = formatStructuredJSON(docData);
        jsonView.textContent = structuredJson;
        
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
    
    // Store full document data to prevent overwriting with incomplete data
    if (hasProcessedData && docData.document_id) {
        if (!window.lastFullDocumentData) window.lastFullDocumentData = {};
        window.lastFullDocumentData[docData.document_id] = docData;
    }
    
    // Store full document data to prevent overwriting with incomplete data
    if (hasProcessedData && docData.document_id) {
        if (!window.lastFullDocumentData) window.lastFullDocumentData = {};
        window.lastFullDocumentData[docData.document_id] = docData;
    }
    
    // Load PDF if available
    if (docData.status === 'complete') {
        if (typeof renderDocumentPreview === 'function') {
            renderDocumentPreview(docData);
        }
    }
    
    // Legacy document view (for backward compatibility)
    const documentView = document.getElementById('document-view');
    if (documentView) {
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
            if (typeof renderTablesSection === 'function') {
                html += renderTablesSection(docData.tables);
            }
        }
        
        documentView.innerHTML = html;
        if (typeof bindTableInteractions === 'function') {
            bindTableInteractions(docData.tables || []);
        }
    }
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
    
    // First, make sure we're on the Parse tab (not Extract or Chat)
    const parseTab = document.querySelector('.main-tab[data-tab="parse"]');
    
    if (parseTab && !parseTab.classList.contains('active')) {
        // Switch to Parse tab
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
        // Find the markdown section
        let section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
        
        // If not found, try finding by exact match or partial match
        if (!section) {
            const allSections = document.querySelectorAll('.markdown-section');
            for (let s of allSections) {
                const sectionChunkId = s.getAttribute('data-chunk-id');
                if (sectionChunkId === chunkId || sectionChunkId === String(chunkId)) {
                    section = s;
                    break;
                }
            }
        }
        
        if (!section) {
            console.warn('scrollToMarkdownSection: Section not found for chunkId:', chunkId);
            return;
        }
        
        // Calculate position relative to parse-content container
        const sectionRect = section.getBoundingClientRect();
        const containerRect = parseContent.getBoundingClientRect();
        const sectionOffsetTop = sectionRect.top - containerRect.top + parseContent.scrollTop;
        const markdownViewOffsetTop = markdownView.offsetTop || 0;
        const sectionRelativeTop = sectionOffsetTop - markdownViewOffsetTop;
        
        // Calculate target scroll position to center the section
        const containerHeight = parseContent.clientHeight;
        const sectionHeight = section.offsetHeight || section.getBoundingClientRect().height;
        const targetScroll = sectionRelativeTop - (containerHeight / 2) + (sectionHeight / 2);
        
        // Clamp to valid scroll range
        const maxScroll = Math.max(0, parseContent.scrollHeight - parseContent.clientHeight);
        const finalScroll = Math.max(0, Math.min(targetScroll, maxScroll));
        
        // Scroll ONLY the right panel (parse-content), NOT the whole page
        parseContent.scrollTo({
            top: finalScroll,
            behavior: 'smooth'
        });
        
        // Also ensure the section is visible
        setTimeout(() => {
            try {
                section.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'center',
                    inline: 'nearest'
                });
            } catch (e) {
                console.warn('scrollIntoView failed, using scrollTo only');
            }
        }, 50);
        
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
            if (typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(chunkId);
            }
            // Highlight markdown section
            highlightMarkdownSection(chunkId);
            // Scroll within parse-content container only (right side)
            scrollToMarkdownSection(chunkId);
        });
        
        section.addEventListener('mouseenter', () => {
            if (typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(chunkId);
            }
            highlightMarkdownSection(chunkId);
        });
        
        section.addEventListener('mouseleave', () => {
            if (typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(null);
            }
            highlightMarkdownSection(null);
        });
    });
}

function renderTablesSection(tables) {
    if (!tables || tables.length === 0) return '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    
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
    const escapeHtml = window.escapeHtml || ((t) => t);
    const header = table.header || [];
    const rows = table.rows || [];
    const title = table.title || `Table ${index + 1}`;
    const pageLabel = typeof table.page === 'number' ? `Page ${table.page + 1}` : 'Page n/a';
    let bodyHtml = '';

    if (rows.length > 0 || header.length > 0) {
        const columns = header.length > 0 ? header : (rows.length > 0 ? Object.keys(rows[0] || {}) : []);
        
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
                            const cellValues = columns.map((col, colIdx) => {
                                let cellValue = row[col] || row[colIdx] || '';
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
                const stage = document.querySelector('.document-stage');
                if (stage) {
                    stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        });
    });
}

function renderCitationChips(citations) {
    if (!citations || citations.length === 0) return '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    
    // Group citations by visual reference to show duplicates (Landing.AI style)
    const grouped = {};
    citations.forEach(citation => {
        // Format like Landing.AI: "Page 1. table" or "8. text"
        let visualRef = '';
        if (citation.page !== undefined && citation.page !== null) {
            const pageNum = parseInt(citation.page) + 1; // Convert 0-based to 1-based
            const chunkType = (citation.type || 'text').toLowerCase();
            visualRef = `Page ${pageNum}. ${chunkType}`;
        } else if (citation.chunk_id) {
            // Fallback: use chunk ID if page not available
            const chunkType = (citation.type || 'text').toLowerCase();
            visualRef = `${citation.chunk_id}. ${chunkType}`;
        } else {
            visualRef = citation.visual_ref || `${citation.type || 'text'}`;
        }
        
        const key = visualRef;
        if (!grouped[key]) {
            grouped[key] = [];
        }
        grouped[key].push(citation);
    });
    
    // Create citation items (show all duplicates like Landing.AI)
    const citationItems = Object.entries(grouped).flatMap(([visualRef, refs]) => {
        // Show each reference separately (like Landing.AI shows duplicates)
        return refs.map(citation => {
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
        });
    }).join('');
    
    return `
        <div class="visual-references-section">
            <div class="visual-references-title">Visual reference for the answer:</div>
            <div class="visual-references-list">
                ${citationItems}
            </div>
        </div>
    `;
}

// Export functions
window.updateDocumentView = updateDocumentView;
window.renderMarkdown = renderMarkdown;
window.formatMarkdownLikeLandingAI = formatMarkdownLikeLandingAI;
window.formatTableHTML = formatTableHTML;
window.renderTablesSection = renderTablesSection;
window.renderTableCard = renderTableCard;
window.bindTableInteractions = bindTableInteractions;
window.highlightChunk = highlightChunk;
window.highlightMarkdownSection = highlightMarkdownSection;
window.scrollToMarkdownSection = scrollToMarkdownSection;
window.setupMarkdownInteractivity = setupMarkdownInteractivity;
window.renderCitationChips = renderCitationChips;

