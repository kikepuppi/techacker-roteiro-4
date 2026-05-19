/**
 * Background Script - TechHacker Privacy Guardian
 * 
 * Este script executa em segundo plano e:
 * - Coleta dados sobre rastreamento da página atual
 * - Comunica-se com content scripts e popup
 * - Armazena dados de privacidade
 */

console.log('[TechHacker] Background script iniciado');

// Objeto para armazenar dados da página atual
let pageData = {};

/**
 * Limpa dados quando uma aba é fechada
 */
browser.tabs.onRemoved.addListener((tabId) => {
  if (pageData[tabId]) {
    delete pageData[tabId];
  }
});

/**
 * Listener para mensagens do content script e popup
 */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[TechHacker] Mensagem recebida:', message);

  const tabId = sender.tab.id;

  switch (message.type) {
    case 'PAGE_LOADED':
      // Content script avisa que a página carregou
      pageData[tabId] = {
        url: sender.tab.url,
        thirdPartyDomains: [],
        cookies: [],
        localStorage: [],
        sessionStorage: [],
        indexedDB: [],
        fingerprinting: [],
        hijackingAttempts: [],
        privacyScore: 0
      };
      console.log('[TechHacker] Página iniciada para aba:', tabId);
      sendResponse({ status: 'ok' });
      break;

    case 'ADD_THIRD_PARTY':
      // Content script detectou domínio terceira parte
      if (!pageData[tabId]) pageData[tabId] = {};
      if (!pageData[tabId].thirdPartyDomains) pageData[tabId].thirdPartyDomains = [];
      pageData[tabId].thirdPartyDomains.push(message.data);
      console.log('[TechHacker] Domínio terceira parte adicionado:', message.data);
      break;

    case 'ADD_FINGERPRINT':
      // Content script detectou tentativa de fingerprinting
      if (!pageData[tabId]) pageData[tabId] = {};
      if (!pageData[tabId].fingerprinting) pageData[tabId].fingerprinting = [];
      pageData[tabId].fingerprinting.push(message.data);
      console.log('[TechHacker] Fingerprinting detectado:', message.data);
      break;

    case 'ADD_HIJACKING':
      // Content script detectou tentativa de hijacking
      if (!pageData[tabId]) pageData[tabId] = {};
      if (!pageData[tabId].hijackingAttempts) pageData[tabId].hijackingAttempts = [];
      pageData[tabId].hijackingAttempts.push(message.data);
      console.log('[TechHacker] Hijacking detectado:', message.data);
      break;

    case 'GET_PAGE_DATA':
      // Popup solicita dados da página atual
      sendResponse(pageData[tabId] || {});
      break;

    default:
      console.log('[TechHacker] Tipo de mensagem desconhecido:', message.type);
      sendResponse({ error: 'Tipo desconhecido' });
  }
});

// Listener para quando a aba é ativada
browser.tabs.onActivated.addListener(async (activeInfo) => {
  console.log('[TechHacker] Aba ativada:', activeInfo.tabId);
});
