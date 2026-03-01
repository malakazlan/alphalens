// FinBot Module — Client-side chat logic
// Handles sending messages, rendering responses, quick actions

(function () {
    'use strict';

    // State
    let sessionId = null;
    let isWaiting = false;

    // ── Helpers ──

    function getApiBase() {
        return typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
    }

    function getHeaders() {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders();
        const token = localStorage.getItem('access_token');
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    }

    // Simple markdown → HTML for bot responses
    function renderMarkdown(md) {
        let html = md;
        // Code blocks
        html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Headers
        html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        // Bold
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic
        html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
        // Links
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
        // Horizontal rules
        html = html.replace(/^---$/gm, '<hr>');
        // Blockquotes
        html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

        // Tables
        const lines = html.split('\n');
        const result = [];
        let tableRows = [];
        let inTable = false;

        for (const line of lines) {
            const trimmed = line.trim();
            if (/^\|(.+)\|$/.test(trimmed)) {
                const cells = trimmed.split('|').filter(c => c.trim()).map(c => c.trim());
                if (cells.every(c => /^:?-+:?$/.test(c))) continue;
                if (!inTable) inTable = true;
                tableRows.push(cells);
            } else {
                if (inTable && tableRows.length) {
                    let t = '<table><thead><tr>';
                    tableRows[0].forEach(c => t += `<th>${c}</th>`);
                    t += '</tr></thead>';
                    if (tableRows.length > 1) {
                        t += '<tbody>';
                        tableRows.slice(1).forEach(row => {
                            t += '<tr>';
                            row.forEach(c => t += `<td>${c}</td>`);
                            t += '</tr>';
                        });
                        t += '</tbody>';
                    }
                    t += '</table>';
                    result.push(t);
                    tableRows = [];
                    inTable = false;
                }
                result.push(line);
            }
        }
        // Handle table at end
        if (inTable && tableRows.length) {
            let t = '<table><thead><tr>';
            tableRows[0].forEach(c => t += `<th>${c}</th>`);
            t += '</tr></thead>';
            if (tableRows.length > 1) {
                t += '<tbody>';
                tableRows.slice(1).forEach(row => {
                    t += '<tr>';
                    row.forEach(c => t += `<td>${c}</td>`);
                    t += '</tr>';
                });
                t += '</tbody>';
            }
            t += '</table>';
            result.push(t);
        }
        html = result.join('\n');

        // Lists
        html = html.replace(/^[\*\-] (.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
        // Numbered lists
        html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

        // Paragraphs
        const parts = html.split('\n\n');
        html = parts.map(p => {
            p = p.trim();
            if (!p) return '';
            if (/^<(h[1-6]|ul|ol|table|blockquote|hr|pre|div|li)/.test(p)) return p;
            return `<p>${p}</p>`;
        }).join('\n');

        // Single newlines → <br>
        html = html.replace(/([^>\n])\n([^<\n])/g, '$1<br>$2');

        return html;
    }

    // ── DOM Manipulation ──

    function getElements() {
        return {
            messages: document.getElementById('finbot-messages'),
            input: document.getElementById('finbot-input'),
            sendBtn: document.getElementById('finbot-send-btn'),
            welcome: document.getElementById('finbot-welcome'),
        };
    }

    function scrollToBottom() {
        const chatBody = document.getElementById('finbot-chat-body');
        if (chatBody) {
            requestAnimationFrame(() => {
                chatBody.scrollTop = chatBody.scrollHeight;
            });
        }
    }

    function hideWelcome() {
        const { welcome } = getElements();
        if (welcome) welcome.style.display = 'none';
    }

    function showWelcome() {
        const { welcome, messages } = getElements();
        if (welcome) welcome.style.display = 'flex';
        // Remove all messages except welcome
        if (messages) {
            const msgs = messages.querySelectorAll('.finbot-msg, .finbot-typing');
            msgs.forEach(m => m.remove());
        }
        // Scroll back to top
        const chatBody = document.getElementById('finbot-chat-body');
        if (chatBody) chatBody.scrollTop = 0;
    }

    function addMessage(role, content, toolsUsed) {
        hideWelcome();
        const { messages } = getElements();
        if (!messages) return;

        const div = document.createElement('div');
        div.className = `finbot-msg ${role}`;

        const avatarContent = role === 'bot'
            ? '<img src="/static/img/finbot.png" alt="" class="finbot-msg-avatar-img">'
            : '👤';
        const bubbleContent = role === 'bot' ? renderMarkdown(content) : escapeHtml(content);

        let toolsBadge = '';
        if (toolsUsed && toolsUsed.length > 0) {
            const toolNames = toolsUsed.map(t => t.tool.replace(/_/g, ' ')).join(', ');
            toolsBadge = `<div class="finbot-tools-badge">🔧 Used: ${toolNames}</div>`;
        }

        div.innerHTML = `
            <div class="finbot-msg-avatar">${avatarContent}</div>
            <div class="finbot-msg-body">
                <div class="finbot-msg-bubble">${bubbleContent}</div>
                ${toolsBadge}
            </div>
        `;
        messages.appendChild(div);
        scrollToBottom();
    }

    function showTyping() {
        const { messages } = getElements();
        if (!messages) return;
        const div = document.createElement('div');
        div.className = 'finbot-typing';
        div.id = 'finbot-typing-indicator';
        div.innerHTML = `
            <div class="finbot-typing-avatar">
                <img src="/static/img/finbot.png" alt="" class="finbot-msg-avatar-img">
            </div>
            <div class="finbot-typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        messages.appendChild(div);
        scrollToBottom();
    }

    function hideTyping() {
        const el = document.getElementById('finbot-typing-indicator');
        if (el) el.remove();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ── API Call ──

    async function sendMessage(text) {
        if (!text.trim() || isWaiting) return;

        isWaiting = true;
        const { input, sendBtn } = getElements();
        if (sendBtn) sendBtn.disabled = true;
        if (input) input.value = '';

        addMessage('user', text);
        showTyping();

        try {
            const response = await fetch(`${getApiBase()}/finbot/chat`, {
                method: 'POST',
                credentials: 'include',
                headers: getHeaders(),
                body: JSON.stringify({
                    message: text,
                    session_id: sessionId
                })
            });

            hideTyping();

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.detail || `Server error (${response.status})`);
            }

            const data = await response.json();
            sessionId = data.session_id || sessionId;
            addMessage('bot', data.response, data.tools_used);

        } catch (err) {
            hideTyping();
            addMessage('bot', `⚠️ Error: ${err.message}. Please try again.`);
        } finally {
            isWaiting = false;
            if (sendBtn) sendBtn.disabled = false;
            if (input) input.focus();
        }
    }

    async function clearChat() {
        try {
            await fetch(`${getApiBase()}/finbot/clear`, {
                method: 'POST',
                credentials: 'include',
                headers: getHeaders(),
                body: JSON.stringify({ session_id: sessionId })
            });
        } catch (e) {
            // Ignore errors on clear
        }
        sessionId = null;
        showWelcome();
    }

    // ── Quick Actions ──

    function handleChipClick(text) {
        const { input } = getElements();
        if (input) input.value = text;
        sendMessage(text);
    }

    // ── Init ──

    function initFinBot() {
        const { input, sendBtn } = getElements();

        if (sendBtn) {
            sendBtn.addEventListener('click', () => {
                if (input && input.value.trim()) sendMessage(input.value.trim());
            });
        }

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (input.value.trim()) sendMessage(input.value.trim());
                }
            });

            // Auto-resize
            input.addEventListener('input', () => {
                input.style.height = 'auto';
                input.style.height = Math.min(input.scrollHeight, 120) + 'px';
            });
        }
    }

    // Expose globals
    window.initFinBot = initFinBot;
    window.finbotSendMessage = sendMessage;
    window.finbotClearChat = clearChat;
    window.finbotChipClick = handleChipClick;

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFinBot);
    } else {
        setTimeout(initFinBot, 100);
    }
})();
