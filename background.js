// Background Service Worker - Monitors tabs and manages storage

const DB_NAME = 'TabMemoryDB';
const DB_VERSION = 1;
const STORE_NAME = 'pages';
const MAX_AGE_DAYS = 30;
const MAX_CONTENT_LENGTH = 50000; // 50k characters per page

// Blacklisted domains (don't track these for privacy)
const BLACKLIST = [
  'chrome://',
  'chrome-extension://',
  'accounts.google.com',
  'login.',
  'signin.',
  'auth.',
  'banking.',
  'paypal.com',
  'localhost',
  '127.0.0.1'
];

// Initialize IndexedDB
let db;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        store.createIndex('url', 'url', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('domain', 'domain', { unique: false });
      }
    };
  });
}

// Check if URL should be tracked
function shouldTrackUrl(url) {
  if (!url) return false;
  
  for (const blocked of BLACKLIST) {
    if (url.includes(blocked)) return false;
  }
  
  return url.startsWith('http://') || url.startsWith('https://');
}

// Save page data to IndexedDB
function savePage(pageData) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject('Database not initialized');
      return;
    }
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // Check if URL already exists today
    const index = store.index('url');
    const request = index.openCursor(IDBKeyRange.only(pageData.url));
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor) {
        // Update existing entry
        const existing = cursor.value;
        const now = Date.now();
        const dayInMs = 24 * 60 * 60 * 1000;
        
        // Only update if last visit was more than 1 hour ago
        if (now - existing.timestamp > 3600000) {
          existing.timestamp = now;
          existing.visitCount = (existing.visitCount || 1) + 1;
          existing.title = pageData.title; // Update title in case it changed
          existing.content = pageData.content; // Update content
          cursor.update(existing);
        }
        resolve();
      } else {
        // Add new entry
        store.add(pageData);
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Clean up old entries (older than MAX_AGE_DAYS)
function cleanupOldEntries() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject('Database not initialized');
      return;
    }
    
    const cutoffTime = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    
    const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      } else {
        resolve();
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CONTENT') {
    const tab = sender.tab;
    
    if (!shouldTrackUrl(message.url)) {
      sendResponse({ success: false, reason: 'URL blacklisted' });
      return;
    }
    
    const pageData = {
      url: message.url,
      title: message.title || tab.title,
      content: message.content.slice(0, MAX_CONTENT_LENGTH),
      domain: new URL(message.url).hostname,
      timestamp: Date.now(),
      favicon: tab.favIconUrl || '',
      description: message.description || '',
      visitCount: 1
    };
    
    savePage(pageData)
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error saving page:', error);
        sendResponse({ success: false, error: error.toString() });
      });
    
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'SEARCH') {
    searchPages(message.query)
      .then(results => sendResponse({ results }))
      .catch(error => sendResponse({ results: [], error: error.toString() }));
    
    return true;
  }
  
  if (message.type === 'GET_STATS') {
    getStats()
      .then(stats => sendResponse({ stats }))
      .catch(error => sendResponse({ stats: {}, error: error.toString() }));
    
    return true;
  }
});

// Search through stored pages
function searchPages(query) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject('Database not initialized');
      return;
    }
    
    if (!query || query.trim().length === 0) {
      resolve([]);
      return;
    }
    
    const results = [];
    const lowerQuery = query.toLowerCase();
    const keywords = lowerQuery.split(/\s+/).filter(k => k.length > 0);
    
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (cursor) {
        const page = cursor.value;
        const searchText = `${page.title} ${page.url} ${page.content}`.toLowerCase();
        
        // Calculate match score
        let score = 0;
        let matchCount = 0;
        
        keywords.forEach(keyword => {
          if (searchText.includes(keyword)) {
            matchCount++;
            // Boost score if keyword is in title
            if (page.title.toLowerCase().includes(keyword)) {
              score += 10;
            }
            // Boost score if keyword is in URL
            if (page.url.toLowerCase().includes(keyword)) {
              score += 5;
            }
            // Base score for content match
            score += 1;
          }
        });
        
        // Only include if at least one keyword matches
        if (matchCount > 0) {
          // Add recency bonus (newer = better)
          const ageInDays = (Date.now() - page.timestamp) / (24 * 60 * 60 * 1000);
          const recencyBonus = Math.max(0, 10 - ageInDays);
          score += recencyBonus;
          
          // Get snippet with matching text
          const snippet = getSnippet(page.content, keywords);
          
          results.push({
            ...page,
            score,
            snippet,
            matchCount
          });
        }
        
        cursor.continue();
      } else {
        // Sort by score (highest first)
        results.sort((a, b) => b.score - a.score);
        resolve(results.slice(0, 50)); // Return top 50 results
      }
    };
    
    request.onerror = () => reject(request.error);
  });
}

// Extract snippet with matching keywords
function getSnippet(content, keywords) {
  const lowerContent = content.toLowerCase();
  
  // Find first occurrence of any keyword
  let firstMatch = -1;
  for (const keyword of keywords) {
    const index = lowerContent.indexOf(keyword);
    if (index !== -1 && (firstMatch === -1 || index < firstMatch)) {
      firstMatch = index;
    }
  }
  
  if (firstMatch === -1) return '';
  
  // Extract ~150 chars around the match
  const start = Math.max(0, firstMatch - 75);
  const end = Math.min(content.length, firstMatch + 75);
  let snippet = content.slice(start, end);
  
  // Add ellipsis if needed
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet = snippet + '...';
  
  return snippet;
}

// Get database statistics
function getStats() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject('Database not initialized');
      return;
    }
    
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();
    
    countRequest.onsuccess = () => {
      resolve({
        totalPages: countRequest.result,
        maxAgeDays: MAX_AGE_DAYS
      });
    };
    
    countRequest.onerror = () => reject(countRequest.error);
  });
}

// Initialize on install
chrome.runtime.onInstalled.addListener(() => {
  openDatabase().then(() => {
    console.log('Tab Memory Extension installed!');
    cleanupOldEntries();
  });
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  openDatabase().then(() => {
    console.log('Tab Memory Extension started!');
    cleanupOldEntries();
  });
});

// Run cleanup daily
setInterval(() => {
  cleanupOldEntries();
}, 24 * 60 * 60 * 1000); // Once per day

// Initialize database immediately
openDatabase();
