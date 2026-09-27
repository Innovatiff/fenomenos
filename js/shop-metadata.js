/* Spreadshop's basket changes document.title even with updateMetadata:false.
   Keep the host page's existing SEO values across hash-route changes. */
(() => {
  'use strict';
  const head = document.head;
  const selectors = ['title', 'link[rel="canonical"]', 'meta[name="description"]',
    'meta[name="robots"]', 'meta[property^="og:"]', 'meta[name^="twitter:"]'];
  const saved = selectors.flatMap(selector => [...head.querySelectorAll(selector)]).map(node => ({
    node, text: node.textContent, attrs: [...node.attributes].map(a => [a.name, a.value])
  }));
  const options = {subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['content', 'href', 'name', 'property', 'rel']};
  const observer = new MutationObserver(() => {
    observer.disconnect();
    // Remove provider-added duplicates only for the host-owned SEO fields.
    for (const selector of selectors) {
      for (const node of head.querySelectorAll(selector)) {
        if (!saved.some(item => item.node === node)) node.remove();
      }
    }
    for (const item of saved) {
      if (item.node.parentNode !== head) head.append(item.node);
      if (item.node.textContent !== item.text) item.node.textContent = item.text;
      for (const [key, value] of item.attrs) {
        if (item.node.getAttribute(key) !== value) item.node.setAttribute(key, value);
      }
    }
    observer.observe(head, options);
  });
  observer.observe(head, options);
})();
