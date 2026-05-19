/**
 * Background Script - TechHacker Privacy Guardian
 *
 * - Mantém pageData[tabId] com tudo que foi detectado em cada aba.
 * - Recebe mensagens do content script (com sender.tab.id) e do popup
 *   (que precisa passar tabId explicitamente porque o popup não roda
 *   dentro de uma aba).
 */

console.log('[TechHacker] Background script iniciado');

const pageData = {};

function ensureTab(tabId) {
  if (!pageData[tabId]) {
    pageData[tabId] = {
      url: null,
      thirdPartyDomains: [],
      cookies: [],
      localStorage: [],
      sessionStorage: [],
      indexedDB: [],
      fingerprinting: [],
      hijackingAttempts: [],
    };
  }
  return pageData[tabId];
}

// Limpa dados quando uma aba é fechada
browser.tabs.onRemoved.addListener((tabId) => {
  delete pageData[tabId];
});

// Quando o usuário navega para outra URL na mesma aba, zera os dados
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return; // só main frame
  delete pageData[details.tabId];
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // tabId vem do sender (content script) OU do próprio payload (popup)
  const tabId =
    (sender && sender.tab && sender.tab.id) ??
    (message && message.tabId) ??
    null;

  if (tabId === null) {
    console.warn('[TechHacker] Mensagem sem tabId:', message);
    sendResponse({ error: 'no tabId' });
    return;
  }

  switch (message.type) {
    case 'PAGE_LOADED': {
      const slot = ensureTab(tabId);
      slot.url = (sender.tab && sender.tab.url) || message.data?.url || null;
      sendResponse({ status: 'ok' });
      break;
    }

    case 'ADD_THIRD_PARTY':
      ensureTab(tabId).thirdPartyDomains.push(message.data);
      break;

    case 'ADD_FINGERPRINT':
      ensureTab(tabId).fingerprinting.push(message.data);
      break;

    case 'ADD_HIJACKING':
      ensureTab(tabId).hijackingAttempts.push(message.data);
      break;

    case 'GET_PAGE_DATA':
      sendResponse(pageData[tabId] || ensureTab(tabId));
      break;

    default:
      console.log('[TechHacker] Tipo desconhecido:', message.type);
      sendResponse({ error: 'unknown type' });
  }
});
