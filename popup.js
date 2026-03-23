// Popup Script - Handles search UI and interaction

const searchInput = document.getElementById('searchInput');
const resultsDiv = document.getElementById('results');
const loadingDiv = document.getElementById('loading');
const statsDiv = document.getElementById('stats');

let searchTimeout;

// Load stats on popup open
loadStats();

// Search as user types
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  
  // Clear previous timeout
  clearTimeout(searchTimeout);
  
  if (query.length === 0) {
    showEmptyState();
    return;
  }
  
  // Debounce search (wait 300ms after user stops typing)
  searchTimeout = setTimeout(() => {
    performSearch(query);
  }, 300);
});

// Handle Enter key
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    if (query.length > 0) {
      performSearch(query);
    }
  }
});

// Perform search
function performSearch(query) {
  showLoading();
  
  chrome.runtime.sendMessage({
    type: 'SEARCH',
    query: query
  }, (response) => {
    hideLoading();
    
    if (response && response.results) {
      displayResults(response.results, query);
    } else {
      showError('Search failed. Please try again.');
    }
  });
}

// Display search results
function displayResults(results, query) {
  if (results.length === 0) {
    showNoResults(query);
    return;
  }
  
  resultsDiv.innerHTML = '';
  
  results.forEach(result => {
    const item = createResultItem(result, query);
    resultsDiv.appendChild(item);
  });
}

// Create result item element
function createResultItem(result, query) {
  const div = document.createElement('div');
  div.className = 'result-item';
  
  // Format timestamp
  const date = new Date(result.timestamp);
  const timeAgo = formatTimeAgo(result.timestamp);
  
  // Highlight query in snippet
  let snippet = result.snippet || '';
  if (snippet) {
    const keywords = query.toLowerCase().split(/\s+/);
    keywords.forEach(keyword => {
      if (keyword.length > 0) {
        const regex = new RegExp(`(${escapeRegex(keyword)})`, 'gi');
        snippet = snippet.replace(regex, '<mark>$1</mark>');
      }
    });
  }
  
  div.innerHTML = `
    <div class="result-title">
      ${result.favicon ? `<img src="${result.favicon}" class="result-favicon" onerror="this.style.display='none'">` : ''}
      <span>${escapeHtml(result.title || 'Untitled')}</span>
      ${result.visitCount > 1 ? `<span class="visit-count">${result.visitCount}x</span>` : ''}
    </div>
    <div class="result-url">${escapeHtml(result.url)}</div>
    <div class="result-meta">
      <span>📅 ${timeAgo}</span>
      <span>🌐 ${escapeHtml(result.domain)}</span>
      ${result.score ? `<span>⭐ Score: ${result.score.toFixed(1)}</span>` : ''}
    </div>
    ${snippet ? `<div class="result-snippet">${snippet}</div>` : ''}
  `;
  
  // Click to open URL
  div.addEventListener('click', () => {
    chrome.tabs.create({ url: result.url });
  });
  
  return div;
}

// Format timestamp as "X ago"
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;
  return 'Just now';
}

// Show empty state
function showEmptyState() {
  resultsDiv.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📚</div>
      <p>Start typing to search through your last 30 days of browsing</p>
      <p class="empty-hint">We've captured every page you've visited</p>
    </div>
  `;
}

// Show no results
function showNoResults(query) {
  resultsDiv.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">🔍</div>
      <p>No results found for "<strong>${escapeHtml(query)}</strong>"</p>
      <p class="no-results-hint">Try different keywords or check your spelling</p>
    </div>
  `;
}

// Show loading
function showLoading() {
  loadingDiv.style.display = 'block';
  resultsDiv.style.display = 'none';
}

// Hide loading
function hideLoading() {
  loadingDiv.style.display = 'none';
  resultsDiv.style.display = 'block';
}

// Show error
function showError(message) {
  resultsDiv.innerHTML = `
    <div class="no-results">
      <div class="no-results-icon">⚠️</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// Load and display stats
function loadStats() {
  chrome.runtime.sendMessage({
    type: 'GET_STATS'
  }, (response) => {
    if (response && response.stats) {
      const { totalPages, maxAgeDays } = response.stats;
      statsDiv.textContent = `${totalPages} pages saved • Last ${maxAgeDays} days`;
    } else {
      statsDiv.textContent = 'Collecting your browsing history...';
    }
  });
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Utility: Escape regex special characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Focus search input on popup open
searchInput.focus();
