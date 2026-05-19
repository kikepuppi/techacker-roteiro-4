/**
 * Content Script - TechHacker Privacy Guardian
 *
 * Roda em isolated world. Responsabilidades:
 *  - Injetar src/injected.js no MAIN world (mesmo contexto JS da página)
 *    para que os hooks de Canvas/WebGL/Audio/fetch/eval funcionem.
 *  - Escutar window.postMessage do script injetado e repassar ao background.
 */

(function () {
  'use strict';

  // Injeta o script no contexto da página.
  // Importante: appendChild antes do head ser parseado garante que os hooks
  // estejam ativos antes do JS da página rodar (content_scripts é
  // document_start no manifest).
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

  // Mapeia categorias do injected.js → tipos de mensagem do background.
  const CATEGORY_TO_TYPE = {
    fingerprint: 'ADD_FINGERPRINT',
    thirdParty: 'ADD_THIRD_PARTY',
    hijacking: 'ADD_HIJACKING',
  };

  // Recebe eventos do MAIN world via postMessage e encaminha ao background.
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__techacker !== 'TECHACKER_EVENT') return;

    const type = CATEGORY_TO_TYPE[data.category];
    if (!type) return;

    try {
      browser.runtime.sendMessage({ type: type, data: data.payload });
    } catch (e) {
      // background pode estar reiniciando — ignora silenciosamente
    }
  });
})();
