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

// Format table HTML for display - render as actual HTML table (Landing.AI style)
// cellChunks: optional array of {id,text,page,box} for each cell — enables data-chunk-id stamping
// parentChunkId: the parent table chunk's ID — used as fallback click target for all cells
function formatTableHTML(tableHTML, textBeforeTable = '', cellChunks = [], parentChunkId = '') {
    if (!tableHTML) return '';

    // ── Extract <table> element from the HTML string ──────────────────────────
    const tableMatch = tableHTML.match(/<table[\s\S]*?<\/table>/i);
    if (!tableMatch) {
        const pipeFallback = markdownPipeTableToHtml(tableHTML);
        return pipeFallback || (window.escapeHtml || (t => t))(tableHTML);
    }

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = tableMatch[0];
    const table = tempDiv.querySelector('table');
    if (!table) return (window.escapeHtml || (t => t))(tableHTML);

    // ── Apply Landing.AI-style class ──────────────────────────────────────────
    table.className = 'extracted-table';
    table.removeAttribute('id');
    table.removeAttribute('style');

    // Build a fast lookup: cellId → cellChunk (from the backend detected_chunks).
    // cellChunks for table_cell items have id = the short td id like "1-2".
    const cellChunkById = new Map();
    (cellChunks || []).forEach(c => { if (c.id) cellChunkById.set(String(c.id), c); });

    // ── Process every cell: stamp data-chunk-id FIRST, then strip id/style/anchors ──
    // CRITICAL ORDER: read id BEFORE removeAttribute so we can stamp data-chunk-id.
    table.querySelectorAll('td, th').forEach(cell => {
        const rawId = cell.getAttribute('id') || '';   // e.g. "1-2" or "1-e"

        // Step 1: If this cell's id matches a cellChunk, stamp data-chunk-id now
        if (rawId && cellChunkById.has(rawId)) {
            const match = cellChunkById.get(rawId);
            cell.dataset.chunkId = rawId;
            if (typeof match.page === 'number') cell.dataset.page = match.page;
            if (match.box) cell.dataset.box = JSON.stringify(match.box);
        }

        // Step 2: Now safe to strip the HTML id/style (keeps DOM clean)
        cell.removeAttribute('id');
        cell.removeAttribute('style');

        // Step 3: Unwrap every <a> inside this cell — keep its text, ditch the element
        cell.querySelectorAll('a').forEach(anchor => {
            const text = document.createTextNode(anchor.textContent);
            anchor.replaceWith(text);
        });
    });

    // ── Promote first row to <thead> if ADE didn't create one ────────────────
    if (!table.querySelector('thead') && table.querySelector('tr')) {
        const firstRow = table.querySelector('tr');
        const thead = document.createElement('thead');
        firstRow.parentNode.insertBefore(thead, firstRow);
        thead.appendChild(firstRow);
        firstRow.querySelectorAll('td').forEach(td => {
            const th = document.createElement('th');
            th.innerHTML = td.innerHTML;
            // Carry over any data attributes we stamped above
            if (td.dataset.chunkId) th.dataset.chunkId = td.dataset.chunkId;
            if (td.dataset.page) th.dataset.page = td.dataset.page;
            if (td.dataset.box) th.dataset.box = td.dataset.box;
            td.replaceWith(th);
        });
    }

    // ── Stamp ALL body tds with data-table-chunk-id (parent fallback) ─────────
    // This lets the click handler highlight the whole table even when there are
    // no table_cell sub-chunks (e.g. old documents that haven't been re-processed).
    if (parentChunkId) {
        table.querySelectorAll('tbody td').forEach(td => {
            td.dataset.tableChunkId = parentChunkId; // fallback
            td.style.cursor = 'pointer';
            td.title = 'Click to highlight in document';
        });
    }

    return `<div class="extracted-table-wrapper">${table.outerHTML}</div>`;
}


/**
 * Convert ADE pipe-separated markdown table into a clean HTML table.
 * Handles the common format ADE returns:
 *   | Header 1 | Header 2 |
 *   |---|---|
 *   | value 1  | value 2  |
 *
 * Returns null if the text is not a pipe-table.
 */
function markdownPipeTableToHtml(text) {
    if (!text || !text.includes('|')) return null;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    // Filter out separator lines (---|---)
    const dataLines = lines.filter(l => !/^[\s|:-]+$/.test(l));
    if (dataLines.length < 2) return null;
    // Must look like a markdown table: most lines start and end with |
    const tableLines = dataLines.filter(l => l.startsWith('|') || l.endsWith('|'));
    if (tableLines.length < 2) return null;

    const parseRow = (line) =>
        line.split('|').map(c => c.trim()).filter((c, i, a) => i > 0 && i < a.length - 1 || (i === 0 && c) || (i === a.length - 1 && c));

    const [headerLine, ...rowLines] = tableLines;
    const headers = parseRow(headerLine);
    if (!headers.length) return null;

    const headerHtml = headers.map(h => `<th>${h}</th>`).join('');
    const rowsHtml = rowLines
        .map(line => {
            const cells = parseRow(line);
            // Pad or trim to match header count
            while (cells.length < headers.length) cells.push('');
            return `<tr>${cells.slice(0, headers.length).map(c => `<td>${c}</td>`).join('')}</tr>`;
        })
        .join('');

    return `<div class="extracted-table-wrapper">
        <table class="extracted-table">
            <thead><tr>${headerHtml}</tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    </div>`;
}

// Make available globally
window.markdownPipeTableToHtml = markdownPipeTableToHtml;

// Format markdown like Landing.AI - structured with numbered sections and proper table rendering
function formatMarkdownLikeLandingAI(docData) {
    let html = '';
    const markdown = docData.document_markdown || '';
    const escapeHtml = window.escapeHtml || ((t) => t);
    const getNumberedLabel = window.getNumberedLabel || ((type, id) => type.toUpperCase());
    const resetCounters = window.resetCounters || (() => { });

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
        // Group chunks by type and render them. Skip table_cell — cells are inside table sections only.
        docData.detected_chunks.forEach((chunk, index) => {
            const chunkType = chunk.type || 'text';
            if (chunkType === 'table_cell') return; // Cells rendered only inside parent table; no separate section

            // Get markdown - prioritize markdown field, then text, then content
            const chunkMarkdown = chunk.markdown || chunk.text || chunk.content || '';

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

                // Render each table as proper HTML, passing table_cell chunks for data-chunk-id stamping
                tables.forEach((tableHTML, idx) => {
                    if (idx > 0) {
                        content += '<div style="margin-top: 24px;"></div>';
                    }
                    const tableIndex = chunkMarkdown.indexOf(tableHTML);
                    const textBeforeTable = tableIndex > 0 ? chunkMarkdown.substring(0, tableIndex) : '';

                    // Get table_cell children of this table chunk to enable per-cell highlighting
                    const parentTableId = chunk.id || chunk.chunk_id || '';
                    const cellChunks = (docData.detected_chunks || [])
                        .filter(c => c.type === 'table_cell' && c.parent_table_id === parentTableId);

                    const formattedTable = formatTableHTML(tableHTML, textBeforeTable, cellChunks, parentTableId);

                    content += formattedTable;
                });

            } else {
                // For text/marginalia, clean up anchor tags and format
                const cleaned = chunkMarkdown
                    .replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '') // Remove anchor tags
                    .replace(/\n\n+/g, '\n\n') // Clean up multiple newlines
                    .trim();

                // Try to render as HTML table if it looks like a pipe-table
                const pipeTableHtml = markdownPipeTableToHtml(cleaned);
                if (pipeTableHtml) {
                    content = pipeTableHtml;
                } else {
                    // Support markdown bold
                    content = escapeHtml(cleaned).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                }
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
                const tableChunkId = chunk.id || chunk.chunk_id || '';
                content = formatTableHTML(section, '', [], tableChunkId);

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
        // Store globally so click handlers can reference it for page navigation
        window.currentDocData = docData;

        // Format markdown like Landing.AI - structured with numbered sections
        const formattedMarkdown = formatMarkdownLikeLandingAI(docData);
        markdownView.innerHTML = formattedMarkdown;

        // Add click handlers to markdown sections AND individual table cells
        if (typeof setupMarkdownInteractivity === 'function') {
            setupMarkdownInteractivity();
        }

        // Show JSON in professional, structured format
        const structuredJson = formatStructuredJSON(docData);
        jsonView.textContent = structuredJson;

        console.log('Parse panel updated with markdown and JSON');
        // Also populate the Extract tab from the same data
        if (typeof populateExtractTab === 'function') populateExtractTab(docData);
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
    // Clear all existing highlights
    document.querySelectorAll('.markdown-section').forEach(section => {
        section.classList.remove('highlighted', 'highlighted--text', 'highlighted--table', 'highlighted--figure');
    });

    if (!chunkId) return;

    const section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
    if (section) {
        // Determine the color class from data-chunk-type
        const chunkType = (section.dataset.chunkType || 'text').toLowerCase();
        const colorClass = (['table', 'table_cell'].includes(chunkType))
            ? 'highlighted--table'
            : (['figure', 'chart', 'graph'].includes(chunkType))
                ? 'highlighted--figure'
                : 'highlighted--text';
        section.classList.add('highlighted', colorClass);
    }
}

function scrollToMarkdownSection(chunkId) {
    if (!chunkId) return;

    // Make sure we are on the Parse tab
    const parseTab = document.querySelector('.main-tab[data-tab="parse"]');
    if (parseTab && !parseTab.classList.contains('active')) {
        parseTab.click();
        setTimeout(() => scrollToMarkdownSection(chunkId), 120);
        return;
    }

    // Ensure markdown view is active (not JSON)
    const markdownView = document.getElementById('markdown-view');
    const jsonView = document.getElementById('json-view');
    if (markdownView && (markdownView.style.display === 'none' || (jsonView && jsonView.style.display !== 'none'))) {
        markdownView.style.display = 'block';
        if (jsonView) jsonView.style.display = 'none';
        document.querySelectorAll('.parse-view-tab').forEach(t => {
            t.classList.toggle('active', t.dataset.view === 'markdown');
        });
        setTimeout(() => scrollToMarkdownSection(chunkId), 80);
        return;
    }

    const parseContent = document.getElementById('parse-content');
    if (!parseContent) return;

    const section = document.querySelector(`.markdown-section[data-chunk-id="${chunkId}"]`);
    if (!section) return;

    // ── Scroll ONLY inside parse-content, never touch the window ──
    // Get position of section relative to parse-content scrollable area
    const containerTop = parseContent.getBoundingClientRect().top;
    const sectionTop = section.getBoundingClientRect().top;
    const offset = sectionTop - containerTop + parseContent.scrollTop;
    const center = offset - (parseContent.clientHeight / 2) + (section.offsetHeight / 2);

    parseContent.scrollTo({ top: Math.max(0, center), behavior: 'smooth' });

    // Highlight with type color
    highlightMarkdownSection(chunkId);

    // Auto-clear highlight after 3 s
    setTimeout(() => highlightMarkdownSection(null), 3000);
}


function setupMarkdownInteractivity() {
    // Add click handlers to all markdown sections
    document.querySelectorAll('.markdown-section').forEach(section => {
        const chunkId = section.dataset.chunkId;
        if (!chunkId) return;

        section.addEventListener('click', (e) => {
            // Don't double-fire if a cell was clicked — the cell handler runs first
            if (e.target.closest('td[data-chunk-id], td[data-table-chunk-id]')) return;

            // Highlight PDF region (left side - no scrolling)
            if (typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(chunkId);
            }
            // Highlight markdown section
            highlightMarkdownSection(chunkId);
            // Scroll within parse-content container only (right side)
            scrollToMarkdownSection(chunkId);
        });

        section.addEventListener('mouseenter', (e) => {
            if (e.target.closest('td[data-chunk-id]')) return;
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

    // ── Cell-level click handler: any td inside an extracted table ────────────
    // Works in two modes:
    //   Precise: td has data-chunk-id (requires re-upload with new processor)
    //            → highlights the exact cell bbox on the PDF
    //   Fallback: td has data-table-chunk-id (always set on all body tds)
    //            → highlights the whole table bbox on the PDF
    const markdownView = document.getElementById('markdown-view');
    if (markdownView && !markdownView._cellClickAttached) {
        markdownView._cellClickAttached = true;

        markdownView.addEventListener('click', (e) => {
            // Find the clicked td — either mode works
            const td = e.target.closest('td[data-chunk-id], td[data-table-chunk-id]');
            if (!td) return;
            e.stopPropagation();

            const cellChunkId = td.dataset.chunkId;       // precise cell bbox ID
            const tableChunkId = td.dataset.tableChunkId;  // parent table bbox ID
            const cellPage = (td.dataset.page !== undefined && td.dataset.page !== '')
                ? parseInt(td.dataset.page, 10) : null;

            // 1. Visual feedback on the clicked cell in the markdown table
            document.querySelectorAll('.extracted-table td.cell-highlighted').forEach(c => {
                c.classList.remove('cell-highlighted');
            });
            td.classList.add('cell-highlighted');

            // 2. Smart PDF highlight with fallback:
            //    Try cell-level first. If no overlay box matched (cell bbox not in detected_chunks),
            //    fall back to the parent table bbox — this is the Landing.AI behaviour.
            const tryHighlight = (id) => {
                if (!id || typeof highlightPdfRegion !== 'function') return false;
                highlightPdfRegion(id);
                // Check synchronously whether an overlay box was activated
                return !!document.querySelector('.overlay-box.active');
            };

            let highlighted = false;
            if (cellChunkId) highlighted = tryHighlight(cellChunkId);
            if (!highlighted && tableChunkId) highlighted = tryHighlight(tableChunkId);

            // 3. Scroll the PDF left-panel to show the highlighted overlay
            const activeBox = document.querySelector('.overlay-box.active');
            if (activeBox) {
                const pageContainer = activeBox.closest('.pdf-page-container');
                const pdfWrapper = document.getElementById('pdf-wrapper');
                if (pageContainer && pdfWrapper) {
                    // Scroll pdf-wrapper container (not the whole window)
                    const wrapperTop = pdfWrapper.getBoundingClientRect().top;
                    const pageTop = pageContainer.getBoundingClientRect().top;
                    const offset = pageTop - wrapperTop + pdfWrapper.scrollTop - 20;
                    pdfWrapper.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
                } else if (pageContainer) {
                    pageContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            } else if (typeof cellPage === 'number' && !isNaN(cellPage)) {
                // Last resort: scroll to the page that contains the cell
                const pageContainer = document.querySelector(
                    `.pdf-page-container[data-page="${cellPage + 1}"]`
                );
                if (pageContainer) {
                    pageContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }

            // 4. Also highlight the parent markdown-section header
            const parentSection = td.closest('.markdown-section');
            if (parentSection) {
                highlightMarkdownSection(parentSection.dataset.chunkId || '');
            }
        });

        // Hover: preview highlight, release on mouse-out
        markdownView.addEventListener('mouseover', (e) => {
            const td = e.target.closest('td[data-chunk-id], td[data-table-chunk-id]');
            if (!td) return;
            const effectiveId = td.dataset.chunkId || td.dataset.tableChunkId;
            if (effectiveId && typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(effectiveId);
            }
        });

        markdownView.addEventListener('mouseleave', () => {
            if (typeof highlightPdfRegion === 'function') {
                highlightPdfRegion(null);
            }
        });
    }
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

    function formatRef(citation) {
        if (citation.visual_ref) return citation.visual_ref;
        const page = citation.page;
        const pageNum = (page !== undefined && page !== null) ? parseInt(page) + 1 : 1;
        let typeLabel = (citation.type || 'text').toLowerCase();
        if (typeLabel === 'table_cell') typeLabel = 'table, cell';
        const val = citation.value || '';
        const valPart = val ? ` | ${val}` : '';
        return `Page ${pageNum}.\n${typeLabel}${valPart}`;
    }

    const citationItems = citations.map(citation => {
        const ref = formatRef(citation);
        const lines = ref.split('\n');
        const topLine = escapeHtml(lines[0] || '');
        const bottomLine = escapeHtml(lines.slice(1).join(' ') || '');

        return `
            <button
                class="visual-reference-item"
                data-citation-chunk="${citation.chunk_id || ''}"
                data-page="${citation.page !== undefined ? citation.page : ''}"
                title="${escapeHtml(citation.title || 'Reference')}"
            >
                <span class="vr-page">${topLine}</span>
                <span class="vr-detail">${bottomLine}</span>
                <span class="vr-arrow">&rarr;</span>
            </button>
        `;
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

window.populateExtractTab = populateExtractTab;

// ════════════════════════════════════════════════════════════════
// EXTRACT TAB — render key fields from detected_chunks + metadata
// ════════════════════════════════════════════════════════════════
function populateExtractTab(docData) {
    const container = document.getElementById('extract-content');
    if (!container) return;
    if (!docData) {
        container.innerHTML = '<div class="extract-empty"><p>No document data available.</p></div>';
        return;
    }
    const groups = [];
    const seenVals = new Set();

    // ── Group 1: Document Info (metadata) ──
    const meta = docData.metadata || {};
    const metaFields = [];
    if (meta.company_name && meta.company_name !== 'Unknown' && meta.company_name !== 'Unknown Company')
        metaFields.push({ key: 'Company / Entity', val: meta.company_name });
    if (meta.document_date && meta.document_date !== 'Unknown Date')
        metaFields.push({ key: 'Document Date', val: meta.document_date });
    if (meta.document_type && meta.document_type !== 'Unknown' && meta.document_type !== 'Document')
        metaFields.push({ key: 'Document Type', val: meta.document_type });
    if (docData.filename)
        metaFields.push({ key: 'Filename', val: docData.filename });
    if (metaFields.length > 0) groups.push({ title: 'Document Info', fields: metaFields });

    // ── Group 2: Key Amounts from backend key_metrics (source of truth) ──
    const keyMetrics = docData.key_metrics || [];
    const amountFields = [];
    keyMetrics.forEach(m => {
        if (!m || !m.name) return;
        const valStr = m.value != null ? String(m.value) : '';
        if (!valStr) return;
        const numVal = parseFloat(valStr.replace(/[^0-9.\-]/g, ''));
        if (!isNaN(numVal) && numVal > 1e7) return;
        const display = typeof m.value === 'number' ? m.value.toLocaleString() : valStr;
        if (!seenVals.has(m.name + display)) {
            seenVals.add(m.name + display);
            seenVals.add(display);
            amountFields.push({ key: m.name, val: display });
        }
    });
    if (amountFields.length > 0) groups.push({ title: 'Key Amounts', fields: amountFields });

    // ── Group 3: Supplementary chunk-based extraction (secondary) ──
    const chunks = docData.detected_chunks || [];
    const extractedFields = [];
    const currencyRe = /(?:PKR|USD|EUR|GBP|Rs\.?|Rs|\$|EUR)\s*[,\d]+(?:\.\d{1,2})?/g;
    const dateRe = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi;
    const totalLabelRe = /total|amount due|net|subtotal|tax|balance/i;

    chunks.filter(c => c.type === 'marginalia').slice(0, 3).forEach(c => {
        const text = (c.text || '').trim().slice(0, 80);
        if (text && !seenVals.has(text)) { seenVals.add(text); extractedFields.push({ key: 'Header / Label', val: text }); }
    });
    chunks.filter(c => ['table', 'table_cell'].includes(c.type)).forEach(c => {
        const text = c.text || '';
        if (!totalLabelRe.test(text)) return;
        (text.match(currencyRe) || []).slice(0, 1).forEach(v => {
            const cleaned = v.replace(/[^0-9.]/g, '');
            const num = parseFloat(cleaned);
            if (isNaN(num) || num > 1e7) return;
            if (!seenVals.has(v)) { seenVals.add(v); extractedFields.push({ key: 'Total / Amount', val: v }); }
        });
    });
    chunks.filter(c => ['text', 'table', 'table_cell'].includes(c.type)).forEach(c => {
        const text = c.text || '';
        (text.match(dateRe) || []).slice(0, 1).forEach(v => {
            if (!seenVals.has(v)) { seenVals.add(v); extractedFields.push({ key: 'Date', val: v }); }
        });
    });
    if (extractedFields.length > 0) groups.push({ title: 'Extracted Values', fields: extractedFields.slice(0, 15) });

    if (groups.length === 0) {
        container.innerHTML = '<div class="extract-empty"><p>No extractable fields found in this document</p></div>';
        return;
    }
    container.innerHTML = groups.map(g => `
        <div class="extract-group">
            <div class="extract-group-title">${g.title}</div>
            <div class="extract-fields">
                ${g.fields.map(f => `<div class="extract-field"><div class="extract-field-key">${f.key}</div><div class="extract-field-val">${f.val}</div></div>`).join('')}
            </div>
        </div>`).join('');
}
