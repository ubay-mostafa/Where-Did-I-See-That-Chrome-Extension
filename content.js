// Content Script - Extracts page content and sends to background

(function() {
  // Don't run on iframes
  if (window !== window.top) return;
  
  // Wait for page to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', extractAndSend);
  } else {
    // Page already loaded
    setTimeout(extractAndSend, 2000); // Wait 2 seconds for dynamic content
  }
  
  function extractAndSend() {
    try {
      const pageData = extractPageContent();
      
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'PAGE_CONTENT',
        ...pageData
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Tab Memory: Could not send page content');
        }
      });
    } catch (error) {
      console.error('Tab Memory extraction error:', error);
    }
  }
  
  function extractPageContent() {
    // Get main content, excluding scripts, styles, nav, footer
    const elementsToRemove = ['script', 'style', 'nav', 'footer', 'header', 'iframe', 'noscript'];
    const clone = document.body.cloneNode(true);
    
    elementsToRemove.forEach(tag => {
      const elements = clone.getElementsByTagName(tag);
      Array.from(elements).forEach(el => el.remove());
    });
    
    // Remove common ad/clutter classes
    const clutterSelectors = [
      '.ad', '.ads', '.advertisement',
      '.sidebar', '.menu', '.navigation',
      '.footer', '.header', '.popup',
      '.modal', '.cookie-banner'
    ];
    
    clutterSelectors.forEach(selector => {
      try {
        const elements = clone.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      } catch (e) {
        // Ignore selector errors
      }
    });
    
    // Get text content
    let content = clone.innerText || clone.textContent || '';
    
    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ') // Multiple spaces to single space
      .replace(/\n\s*\n/g, '\n') // Multiple newlines to single
      .trim();
    
    // Get meta description
    const metaDesc = document.querySelector('meta[name="description"]');
    const description = metaDesc ? metaDesc.getAttribute('content') : '';
    
    return {
      url: window.location.href,
      title: document.title,
      content: content,
      description: description
    };
  }
})();
