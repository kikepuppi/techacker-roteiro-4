/**
 * Content Script - TechHacker Privacy Guardian
 *
 * Roda em isolated world. Responsabilidades:
 *  - Injetar src/injected.js no MAIN world (mesmo contexto JS da página)
 *    para que os hooks de Canvas/WebGL/Audio/eval funcionem.
 *  - Escutar window.postMessage do script injetado e repassar ao background.
 *  - Coletar localStorage, sessionStorage e IndexedDB (acessíveis do isolated
 *    world porque storage é por origem) e responder a pedidos do background.
 */

(function () {
  'use strict';

  // Injeta o script no contexto da página.
  try {
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('src/injected.js');
    script.async = false;
    script.onload = function () {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.warn('[TechHacker] Falha ao injetar script no page world:', e);
  }

  // Avisa o background que a página carregou (cria o slot de pageData).
  browser.runtime.sendMessage({
    type: 'PAGE_LOADED',
    data: { url: window.location.href },
  });

  // ===========================================================================
  // Bridge MAIN world → background
  // ===========================================================================
  const CATEGORY_TO_TYPE = {
    fingerprint: 'ADD_FINGERPRINT',
    thirdParty: 'ADD_THIRD_PARTY',
    hijacking: 'ADD_HIJACKING',
  };

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__techacker !== 'TECHACKER_EVENT') return;

    const type = CATEGORY_TO_TYPE[data.category];
    if (!type) return;

    try {
      browser.runtime.sendMessage({ type: type, data: data.payload });
    } catch (e) {}
  });

  // ===========================================================================
  // Coleta de Storage (localStorage, sessionStorage, IndexedDB)
  //
  // - localStorage e sessionStorage são síncronos e acessíveis pelo isolated
  //   world, porque são scoped por origem (não por contexto JS).
  // - IndexedDB.databases() lista os bancos da origem.
  // - Coletamos só no main frame para não duplicar dados de iframes (cada
  //   iframe roda seu próprio content script, mas teria origem diferente).
  // ===========================================================================
  function collectWebStorage(storage, type) {
    const entries = [];
    if (!storage) return entries;
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key === null) continue;
        const value = storage.getItem(key) || '';
        // Aproximação: chars × 2 (UTF-16). Suficiente pra UI, não pra audit.
        const size = (key.length + value.length) * 2;
        entries.push({
          key: key,
          type: type,
          size: size,
          domain: window.location.hostname,
        });
      }
    } catch (e) {
      // SecurityError em alguns iframes com sandbox
    }
    return entries;
  }

  async function collectIndexedDB() {
    if (!window.indexedDB || typeof window.indexedDB.databases !== 'function') {
      return [];
    }
    try {
      const dbs = await window.indexedDB.databases();
      return dbs.map((db) => ({
        name: db.name || '(sem nome)',
        version: db.version || 0,
        domain: window.location.hostname,
      }));
    } catch (e) {
      return [];
    }
  }

  async function snapshotStorage() {
    if (window !== window.top) return null; // só main frame
    return {
      localStorage: collectWebStorage(window.localStorage, 'localStorage'),
      sessionStorage: collectWebStorage(window.sessionStorage, 'sessionStorage'),
      indexedDB: await collectIndexedDB(),
    };
  }

  // Envia snapshot inicial quando a página termina de carregar
  function sendSnapshot() {
    snapshotStorage().then((snap) => {
      if (!snap) return;
      try {
        browser.runtime.sendMessage({ type: 'STORAGE_SNAPSHOT', data: snap });
      } catch (e) {}
    });
  }

  if (document.readyState === 'complete') {
    sendSnapshot();
  } else {
    window.addEventListener('load', sendSnapshot);
  }

  // Permite o background pedir um snapshot fresco (quando o popup abre)
  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'COLLECT_STORAGE') {
      return snapshotStorage();
    }
  });
})();
