/**
 * FinBot News Sidebar — fetch financial news, carousel with auto-advance
 */
(function () {
    'use strict';

    const AUTO_ADVANCE_MS = 6000;
    const CACHE_TTL_MS = 5 * 60 * 1000;

    let currentIndex = 0;
    let newsItems = [];
    let autoAdvanceTimer = null;
    let lastFetchTime = 0;

    function getApiBase() {
        return typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : window.location.origin;
    }

    function getHeaders() {
        if (typeof getAuthHeaders === 'function') return getAuthHeaders();
        const token = localStorage.getItem('access_token');
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': 'Bearer ' + token } : {})
        };
    }

    function getEl(id) {
        return document.getElementById(id);
    }

    function showLoading(show) {
        const loading = getEl('finbot-news-loading');
        const empty = getEl('finbot-news-empty');
        const cards = getEl('finbot-news-cards');
        if (loading) loading.style.display = show ? 'block' : 'none';
        if (empty) empty.style.display = 'none';
        if (cards) cards.style.display = show ? 'none' : 'flex';
    }

    function showEmpty(message) {
        const loading = getEl('finbot-news-loading');
        const empty = getEl('finbot-news-empty');
        const cards = getEl('finbot-news-cards');
        if (loading) loading.style.display = 'none';
        if (empty) {
            empty.textContent = message || 'No news right now.';
            empty.style.display = 'block';
        }
        if (cards) cards.style.display = 'none';
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function getCategoryIcon(category) {
        var c = (category || '').toLowerCase();
        if (c.indexOf('market') >= 0 || c.indexOf('stock') >= 0) {
            return '<svg class="finbot-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 6 13.5 15 8.5 10 2 16"/><polyline points="16 6 22 6 22 12"/></svg>';
        }
        if (c.indexOf('policy') >= 0 || c.indexOf('fed') >= 0 || c.indexOf('rate') >= 0) {
            return '<svg class="finbot-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="3" x2="12" y2="21"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><path d="M8 15V9"/><path d="M12 15V9"/><path d="M16 15V9"/></svg>';
        }
        if (c.indexOf('crypto') >= 0 || c.indexOf('bitcoin') >= 0 || c.indexOf('btc') >= 0) {
            return '<svg class="finbot-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9 8h4a2 2 0 110 4H9V8z"/><path d="M15 12h-3a2 2 0 110 4h4v-4z"/></svg>';
        }
        if (c.indexOf('earning') >= 0 || c.indexOf('company') >= 0 || c.indexOf('profit') >= 0) {
            return '<svg class="finbot-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
        }
        return '<svg class="finbot-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>';
    }

    function renderCards() {
        const wrapper = getEl('finbot-news-cards');
        const dotsEl = getEl('finbot-news-dots');
        if (!wrapper || !dotsEl) return;

        wrapper.innerHTML = '';
        dotsEl.innerHTML = '';

        if (!newsItems.length) {
            showEmpty('No news right now.');
            renderBreakingList();
            return;
        }

        showLoading(false);
        wrapper.style.display = 'flex';

        newsItems.forEach(function (item, i) {
            const card = document.createElement('div');
            card.className = 'finbot-news-card';
            card.setAttribute('data-index', i);

            const title = item.title || 'No title';
            const source = item.source || 'Source';
            const date = item.date || '';
            const url = item.url || '#';
            const image = item.image;

            let imageBlock = '';
            if (image) {
                imageBlock = '<img class="finbot-news-card-image" src="' + escapeHtml(image) + '" alt="">';
            } else {
                imageBlock = '<div class="finbot-news-card-placeholder">&#128240;</div>';
            }

            card.innerHTML =
                '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;display:block;position:relative;">' +
                imageBlock +
                '<div class="finbot-news-card-overlay">' +
                '<div class="finbot-news-card-source">' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</div>' +
                '<h4 class="finbot-news-card-title">' + escapeHtml(title) + '</h4>' +
                '</div></a>';
            wrapper.appendChild(card);

            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'finbot-carousel-dot' + (i === 0 ? ' active' : '');
            dot.setAttribute('aria-label', 'Go to slide ' + (i + 1));
            dot.setAttribute('data-index', i);
            dotsEl.appendChild(dot);
        });

        goToSlide(0);
        renderBreakingList();
    }

    function renderBreakingList() {
        const listEl = getEl('finbot-breaking-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!newsItems.length) return;
        var maxItems = Math.min(5, newsItems.length);
        for (var i = 0; i < maxItems; i++) {
            var item = newsItems[i];
            var a = document.createElement('a');
            a.href = item.url || '#';
            a.target = '_blank';
            a.rel = 'noopener';
            a.className = 'finbot-breaking-item';
            var cat = (item.category || 'NEWS').toUpperCase();
            var meta = item.date ? item.date + ' • ' + cat : cat;
            var iconSvg = getCategoryIcon(item.category || item.source);
            a.innerHTML =
                '<span class="finbot-breaking-icon finbot-breaking-icon--cat">' + iconSvg + '</span>' +
                '<div class="finbot-breaking-content">' +
                '<span class="finbot-breaking-headline">' + escapeHtml(item.title || 'No title') + '</span>' +
                '<span class="finbot-breaking-meta">' + escapeHtml(meta) + '</span>' +
                '</div>';
            listEl.appendChild(a);
        }
    }

    function goToSlide(index) {
        const total = newsItems.length;
        if (total === 0) return;
        currentIndex = ((index % total) + total) % total;

        const wrapper = getEl('finbot-news-cards');
        const dots = document.querySelectorAll('.finbot-carousel-dot');
        if (wrapper) {
            const offset = -currentIndex * 100;
            wrapper.style.transform = 'translateX(' + offset + '%)';
        }
        dots.forEach(function (d, i) {
            d.classList.toggle('active', i === currentIndex);
        });
    }

    function nextSlide() {
        if (newsItems.length === 0) return;
        goToSlide(currentIndex + 1);
    }

    function prevSlide() {
        if (newsItems.length === 0) return;
        goToSlide(currentIndex - 1);
    }

    function startAutoAdvance() {
        stopAutoAdvance();
        if (getEl('finbot-news-pause') && getEl('finbot-news-pause').checked) return;
        autoAdvanceTimer = setInterval(nextSlide, AUTO_ADVANCE_MS);
    }

    function stopAutoAdvance() {
        if (autoAdvanceTimer) {
            clearInterval(autoAdvanceTimer);
            autoAdvanceTimer = null;
        }
    }

    function fetchNews() {
        if (!getEl('finbot-news-cards')) return;

        if (Date.now() - lastFetchTime < CACHE_TTL_MS && newsItems.length > 0) {
            renderCards();
            return;
        }

        showLoading(true);
        fetch(getApiBase() + '/finbot/news?category=general&limit=10', {
            method: 'GET',
            credentials: 'include',
            headers: getHeaders()
        })
            .then(function (res) {
                if (!res.ok) throw new Error('News unavailable');
                return res.json();
            })
            .then(function (data) {
                lastFetchTime = Date.now();
                newsItems = data.news || [];
                renderCards();
                startAutoAdvance();
            })
            .catch(function () {
                newsItems = [];
                showEmpty('News temporarily unavailable.');
                renderBreakingList();
            });
    }

    function init() {
        const insightsSection = getEl('finbot-insights');
        if (!getEl('finbot-news-cards')) return;

        if (insightsSection) {
            insightsSection.addEventListener('mouseenter', stopAutoAdvance);
            insightsSection.addEventListener('mouseleave', startAutoAdvance);
            insightsSection.addEventListener('focusin', stopAutoAdvance);
            insightsSection.addEventListener('focusout', startAutoAdvance);
        }

        document.addEventListener('click', function (e) {
            const dot = e.target.closest('.finbot-carousel-dot');
            if (dot && dot.dataset.index !== undefined) {
                goToSlide(parseInt(dot.dataset.index, 10));
                startAutoAdvance();
            }
        });

        fetchNews();
    }

    function loadWhenVisible() {
        const section = getEl('finbot-section');
        if (!section) return;
        if (section.style.display !== 'none') {
            init();
            return;
        }
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (m) {
                if (m.attributeName === 'style' &&
                    (section.style.display === 'flex' || section.style.display === 'block')) {
                    init();
                    observer.disconnect();
                }
                if (m.attributeName === 'class' && section.classList.contains('finbot-visible')) {
                    init();
                    observer.disconnect();
                }
            });
        });
        observer.observe(section, { attributes: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadWhenVisible);
    } else {
        loadWhenVisible();
    }

    window.finbotNewsRefresh = fetchNews;
})();
