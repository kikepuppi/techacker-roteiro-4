/**
 * Background Script - TechHacker Privacy Guardian
 *
 * Mantém pageData[tabId] com:
 *  - thirdPartyDomains: [{domain, type, url, timestamp}] via webRequest
 *  - cookies: [{name, domain, party, lifetime, ...}] via browser.cookies
 *  - supercookies: [{kind: 'etag'|'hsts', domain, url, value}] via webRequest
 *  - cookieSyncing: [{value, paramName, domains: [...]}] via webRequest
 *  - fingerprinting / hijackingAttempts: via injected.js → content.js
 *
 * O webRequest API do Firefox vê TODAS as requisições (script/image/iframe/
 * xhr/font/etc) e é a forma confiável de rastrear 3ª parte, em vez de
 * fazer hook só de fetch/XHR no page world.
 */

console.log('[TechHacker] Background script iniciado');

const pageData = {};
const tabUrls = {}; // tabId → URL do main_frame atual

// Cache de sincronismo de cookies: por tabId, mapeia valor → Set<baseDomain>
const syncCache = {};

function ensureTab(tabId) {
  if (!pageData[tabId]) {
    pageData[tabId] = {
      url: null,
      thirdPartyDomains: [],
      cookies: [],
      supercookies: [],
      cookieSyncing: [],
      localStorage: [],
      sessionStorage: [],
      indexedDB: [],
      fingerprinting: [],
      hijackingAttempts: [],
      _seenDomainType: new Set(),
      _seenSupercookie: new Set(),
      _seenSync: new Set(),
    };
  }
  return pageData[tabId];
}

function resetTab(tabId) {
  delete pageData[tabId];
  delete syncCache[tabId];
}

function getBaseDomain(domain) {
  if (!domain) return null;
  const clean = domain.replace(/^\./, '');
  const parts = clean.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : clean;
}

function parseHostname(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

// =============================================================================
// Coleta de cookies (1ª/3ª parte, sessão/persistente)
// =============================================================================
async function collectCookies(tabId) {
  const data = pageData[tabId];
  if (!data || !data.url) return;

  const pageHostname = parseHostname(data.url);
  if (!pageHostname) return;
  const pageBaseDomain = getBaseDomain(pageHostname);

  const firstPartyCookies = await browser.cookies
    .getAll({ url: data.url })
    .catch(() => []);

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
// webRequest: rastreamento de 3ª parte + cookie syncing + supercookies
// =============================================================================

// Tipos de recurso que vamos exibir na UI
const TYPE_LABELS = {
  main_frame: 'documento',
  sub_frame: 'iframe',
  stylesheet: 'css',
  script: 'script',
  image: 'imagem',
  imageset: 'imagem',
  font: 'font',
  object: 'object',
  xmlhttprequest: 'xhr',
  ping: 'beacon',
  csp_report: 'csp',
  media: 'media',
  websocket: 'websocket',
  beacon: 'beacon',
  web_manifest: 'manifest',
  other: 'outro',
};

// Heurística para detectar cookie syncing — só inspeciona params com nomes
// típicos de identificador de usuário/parceiro
const SYNC_PARAM_NAMES = /^(uid|user_id|userid|user|id|gid|cid|did|sid|fid|cookie_?id|partner_?id|sync|guid|adid|uuid|tuuid|tu_id|tdid|euid|ext_id)$/i;

function looksLikeId(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 10 || value.length > 200) return false;
  // ID alfanumérico (permite _, -, . e ~)
  return /^[A-Za-z0-9_\-.~%]+$/.test(value);
}

function inspectSyncing(tabId, requestUrl, requestDomain) {
  const baseDomain = getBaseDomain(requestDomain);
  let url;
  try {
    url = new URL(requestUrl);
  } catch (e) {
    return;
  }
  if (!url.search) return;

  const tabSync = syncCache[tabId] || (syncCache[tabId] = new Map());
  const data = ensureTab(tabId);

  for (const [name, value] of url.searchParams) {
    if (!SYNC_PARAM_NAMES.test(name)) continue;
    if (!looksLikeId(value)) continue;

    let domains = tabSync.get(value);
    if (!domains) {
      domains = new Set();
      tabSync.set(value, domains);
    }
    domains.add(baseDomain);

    if (domains.size >= 2) {
      const syncKey = `${value}|${[...domains].sort().join(',')}`;
      if (data._seenSync.has(syncKey)) continue;
      data._seenSync.add(syncKey);

      data.cookieSyncing.push({
        value: value,
        paramName: name,
        domains: [...domains],
        timestamp: Date.now(),
      });
    }
  }
}

// Heurísticas de scripts suspeitos para hijacking/hooking. Conservadoras
// (poucos falsos positivos), pegando padrões clássicos de framework de
// exploração de browser.
const SUSPICIOUS_SCRIPT_PATTERNS = [
  { name: 'BeEF hook.js', re: /\/hook\.js(\?|$)/i },
  { name: 'BeEF path', re: /\/beef\//i },
  { name: 'BeEF default port', re: /:3000\/hook/i },
  { name: 'metasploit autopwn', re: /\/autopwn\//i },
];

function inspectSuspiciousScript(slot, url) {
  for (const p of SUSPICIOUS_SCRIPT_PATTERNS) {
    if (p.re.test(url)) {
      slot.hijackingAttempts.push({
        type: `script suspeito: ${p.name}`,
        target: url.slice(0, 200),
        timestamp: Date.now(),
      });
      return;
    }
  }
}

// onBeforeRequest: 3ª parte + cookie syncing + scripts suspeitos
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return; // requisição não atrelada a aba (background fetch)

    if (details.type === 'main_frame') {
      // Atualiza o cache antes que sub-requisições sejam comparadas
      tabUrls[tabId] = details.url;
      return;
    }

    const pageUrl = tabUrls[tabId];
    if (!pageUrl) return; // ainda não sabemos qual é a página

    const pageBase = getBaseDomain(parseHostname(pageUrl));
    const reqHost = parseHostname(details.url);
    if (!reqHost) return;
    const reqBase = getBaseDomain(reqHost);

    const slot = ensureTab(tabId);
    if (!slot.url) slot.url = pageUrl;

    // Scripts suspeitos: aplicar mesmo para 1ª parte (BeEF/exploit pode estar
    // hospedado no próprio domínio comprometido)
    if (details.type === 'script') {
      inspectSuspiciousScript(slot, details.url);
    }

    if (!reqBase || reqBase === pageBase) return; // 1ª parte, ignora p/ tracking

    const typeLabel = TYPE_LABELS[details.type] || details.type;
    const key = `${reqHost}|${typeLabel}`;
    if (!slot._seenDomainType.has(key)) {
      slot._seenDomainType.add(key);
      slot.thirdPartyDomains.push({
        domain: reqHost,
        type: typeLabel,
        url: details.url,
        timestamp: Date.now(),
      });
    }

    inspectSyncing(tabId, details.url, reqHost);
  },
  { urls: ['<all_urls>'] }
);

// onHeadersReceived: supercookie candidates (ETag em pixels de tracking, HSTS longo)
const ONE_YEAR = 365 * 24 * 60 * 60;
const TRACKING_TYPES = new Set(['image', 'imageset', 'xmlhttprequest', 'ping', 'beacon']);

// Heurística para descartar ETags que são hashes de conteúdo (MD5/SHA1/SHA256),
// formato padrão de cache em CDNs — não são supercookies. Remove aspas e prefixo
// W/ (weak ETag) antes de comparar.
function looksLikeContentHash(etag) {
  const stripped = etag.replace(/^W\//, '').replace(/^"|"$/g, '');
  return /^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(stripped);
}

browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    const tabId = details.tabId;
    if (tabId < 0) return;

    const pageUrl = tabUrls[tabId];
    if (!pageUrl) return;

    const pageBase = getBaseDomain(parseHostname(pageUrl));
    const reqHost = parseHostname(details.url);
    if (!reqHost) return;
    const reqBase = getBaseDomain(reqHost);
    if (!reqBase || reqBase === pageBase) return;

    const slot = ensureTab(tabId);
    const headers = details.responseHeaders || [];

    for (const h of headers) {
      const name = h.name.toLowerCase();

      if (name === 'etag' && TRACKING_TYPES.has(details.type)) {
        if (looksLikeContentHash(h.value)) continue; // MD5/SHA1/SHA256 = cache, não supercookie
        const key = `etag|${reqHost}|${h.value}`;
        if (slot._seenSupercookie.has(key)) continue;
        slot._seenSupercookie.add(key);
        slot.supercookies.push({
          kind: 'etag',
          domain: reqHost,
          url: details.url,
          value: h.value.slice(0, 80),
          resourceType: details.type,
          timestamp: Date.now(),
        });
      }

      if (name === 'strict-transport-security') {
        const match = /max-age\s*=\s*(\d+)/i.exec(h.value);
        if (match && parseInt(match[1], 10) > ONE_YEAR) {
          const key = `hsts|${reqHost}`;
          if (slot._seenSupercookie.has(key)) continue;
          slot._seenSupercookie.add(key);
          slot.supercookies.push({
            kind: 'hsts',
            domain: reqHost,
            url: details.url,
            value: `max-age=${match[1]}`,
            timestamp: Date.now(),
          });
        }
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// =============================================================================
// Ciclo de vida das abas
// =============================================================================
browser.tabs.onRemoved.addListener((tabId) => {
  resetTab(tabId);
  delete tabUrls[tabId];
});

browser.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  resetTab(details.tabId);
  tabUrls[details.tabId] = details.url;
});

browser.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;
  collectCookies(details.tabId);
});

// =============================================================================
// Mensagens (do content.js e do popup)
// =============================================================================

// Remove campos privados (_seenDomainType etc.) antes de mandar para o popup,
// para não inflar o payload.
function publicView(slot) {
  if (!slot) return slot;
  const { _seenDomainType, _seenSupercookie, _seenSync, ...rest } = slot;
  return rest;
}

// Pede ao content script um snapshot fresco de storage. Falha silenciosamente
// em URLs onde o content script não pode rodar (about:, moz-extension:, etc).
async function refreshStorageFromContent(tabId) {
  try {
    const snap = await browser.tabs.sendMessage(tabId, { type: 'COLLECT_STORAGE' });
    if (snap) {
      const slot = ensureTab(tabId);
      slot.localStorage = snap.localStorage || [];
      slot.sessionStorage = snap.sessionStorage || [];
      slot.indexedDB = snap.indexedDB || [];
    }
  } catch (e) {
    // sem content script disponível
  }
}

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

    case 'ADD_FINGERPRINT':
      ensureTab(tabId).fingerprinting.push(message.data);
      return;

    case 'ADD_HIJACKING':
      ensureTab(tabId).hijackingAttempts.push(message.data);
      return;

    case 'ADD_THIRD_PARTY':
      // legado — agora preferimos webRequest. Aceita ainda assim caso algo
      // venha do injected.js.
      ensureTab(tabId).thirdPartyDomains.push(message.data);
      return;

    case 'STORAGE_SNAPSHOT': {
      const slot = ensureTab(tabId);
      slot.localStorage = message.data.localStorage || [];
      slot.sessionStorage = message.data.sessionStorage || [];
      slot.indexedDB = message.data.indexedDB || [];
      return;
    }

    case 'GET_PAGE_DATA':
      await collectCookies(tabId);
      await refreshStorageFromContent(tabId);
      return publicView(pageData[tabId] || ensureTab(tabId));

    default:
      console.log('[TechHacker] Tipo desconhecido:', message.type);
      return { error: 'unknown type' };
  }
});
