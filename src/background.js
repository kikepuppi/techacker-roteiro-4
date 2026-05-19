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

function getBaseDomain(domain) {
  if (!domain) return null;
  const clean = domain.replace(/^\./, '');
  const parts = clean.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
}

// =============================================================================
// Coleta de cookies
// =============================================================================
async function collectCookies(tabId) {
  const data = pageData[tabId];
  if (!data || !data.url) return;

  let pageHostname;
  try {
    pageHostname = new URL(data.url).hostname;
  } catch (e) {
    return;
  }
  const pageBaseDomain = getBaseDomain(pageHostname);

  // Cookies que seriam enviados para a URL da página (majoritariamente 1ª parte)
  const firstPartyCookies = await browser.cookies
    .getAll({ url: data.url })
    .catch(() => []);

  // Cookies de cada domínio 3ª parte que vimos via injected.js
  const thirdPartyBaseDomains = new Set();
  for (const entry of data.thirdPartyDomains) {
    const base = getBaseDomain(entry.domain);
    if (base && base !== pageBaseDomain) thirdPartyBaseDomains.add(base);
  }

  const thirdPartyCookies = [];
  for (const base of thirdPartyBaseDomains) {
    const cks = await browser.cookies.getAll({ domain: base }).catch(() => []);
    thirdPartyCookies.push(...cks);
  }

  // Dedupe por (domain, name, path) e classifica
  const seen = new Set();
  const cookies = [];
  for (const c of [...firstPartyCookies, ...thirdPartyCookies]) {
    const key = `${c.domain}|${c.name}|${c.path}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cookieBase = getBaseDomain(c.domain);
    cookies.push({
      name: c.name,
      domain: c.domain,
      path: c.path,
      party: cookieBase === pageBaseDomain ? 'primeira' : 'terceira',
      lifetime: c.session ? 'sessão' : 'persistente',
      expirationDate: c.expirationDate || null,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    });
  }

  data.cookies = cookies;
}

// =============================================================================
// Ciclo de vida das abas
// =============================================================================
browser.tabs.onRemoved.addListener((tabId) => {
  delete pageData[tabId];
});

// Zera ao navegar para outra URL na mesma aba
browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  delete pageData[details.tabId];
});

// Coleta cookies quando a página termina de carregar
browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  collectCookies(details.tabId);
});

// =============================================================================
// Mensagens
// =============================================================================
browser.runtime.onMessage.addListener(async (message, sender) => {
  const tabId =
    (sender && sender.tab && sender.tab.id) ??
    (message && message.tabId) ??
    null;

  if (tabId === null) {
    console.warn('[TechHacker] Mensagem sem tabId:', message);
    return { error: 'no tabId' };
  }

  switch (message.type) {
    case 'PAGE_LOADED': {
      const slot = ensureTab(tabId);
      slot.url = (sender.tab && sender.tab.url) || message.data?.url || null;
      return { status: 'ok' };
    }

    case 'ADD_THIRD_PARTY':
      ensureTab(tabId).thirdPartyDomains.push(message.data);
      return;

    case 'ADD_FINGERPRINT':
      ensureTab(tabId).fingerprinting.push(message.data);
      return;

    case 'ADD_HIJACKING':
      ensureTab(tabId).hijackingAttempts.push(message.data);
      return;

    case 'GET_PAGE_DATA':
      await collectCookies(tabId);
      return pageData[tabId] || ensureTab(tabId);

    default:
      console.log('[TechHacker] Tipo desconhecido:', message.type);
      return { error: 'unknown type' };
  }
});
