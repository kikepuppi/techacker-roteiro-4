/**
 * Injected Script - TechHacker Privacy Guardian
 *
 * Este script é injetado no MAIN world (mesmo contexto JS da página) pelo
 * content.js. Sem isso, sobrescrever protótipos não tem efeito sobre o
 * código da página, porque content scripts rodam em isolated world.
 *
 * Comunica detecções para o content.js via window.postMessage com tag
 * "TECHACKER_EVENT".
 */
(function () {
  'use strict';

  if (window.__techackerInjected) return;
  window.__techackerInjected = true;

  const TAG = 'TECHACKER_EVENT';

  function emit(category, payload) {
    try {
      window.postMessage(
        {
          __techacker: TAG,
          category: category,
          payload: Object.assign({ timestamp: Date.now() }, payload),
        },
        '*'
      );
    } catch (e) {
      // ignora erros de postMessage em iframes sandbox
    }
  }

  function getCaller() {
    try {
      const stack = new Error().stack.split('\n');
      return stack[3] ? stack[3].trim() : '';
    } catch (e) {
      return '';
    }
  }

  function getDomain(url) {
    try {
      return new URL(url, window.location.href).hostname;
    } catch (e) {
      return null;
    }
  }

  function getBaseDomain(domain) {
    if (!domain) return null;
    const parts = domain.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : domain;
  }

  const mainBaseDomain = getBaseDomain(window.location.hostname);

  // =========================================================================
  // 1. FINGERPRINTING — Canvas
  // =========================================================================
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function () {
      emit('fingerprint', { method: 'Canvas.toDataURL', caller: getCaller() });
      return origToDataURL.apply(this, arguments);
    };

    const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      emit('fingerprint', { method: 'Canvas.getImageData', caller: getCaller() });
      return origGetImageData.apply(this, arguments);
    };
  } catch (e) {}

  // =========================================================================
  // 2. FINGERPRINTING — WebGL
  // =========================================================================
  try {
    const WEBGL_DEBUG_RENDERER = 0x9246; // UNMASKED_RENDERER_WEBGL
    const WEBGL_DEBUG_VENDOR = 0x9245;   // UNMASKED_VENDOR_WEBGL

    function wrapGetParameter(proto) {
      if (!proto) return;
      const orig = proto.getParameter;
      proto.getParameter = function (pname) {
        if (pname === WEBGL_DEBUG_RENDERER || pname === WEBGL_DEBUG_VENDOR) {
          emit('fingerprint', {
            method: 'WebGL.getParameter (debug_renderer_info)',
            caller: getCaller(),
          });
        }
        return orig.call(this, pname);
      };
    }

    wrapGetParameter(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    wrapGetParameter(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  } catch (e) {}

  // =========================================================================
  // 3. FINGERPRINTING — AudioContext
  // =========================================================================
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const OfflineAudioCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;

    function wrapAudio(proto) {
      if (!proto) return;
      const origOsc = proto.createOscillator;
      if (origOsc) {
        proto.createOscillator = function () {
          emit('fingerprint', { method: 'AudioContext.createOscillator', caller: getCaller() });
          return origOsc.apply(this, arguments);
        };
      }
      const origCompressor = proto.createDynamicsCompressor;
      if (origCompressor) {
        proto.createDynamicsCompressor = function () {
          emit('fingerprint', { method: 'AudioContext.createDynamicsCompressor', caller: getCaller() });
          return origCompressor.apply(this, arguments);
        };
      }
    }

    if (AudioCtx) wrapAudio(AudioCtx.prototype);
    if (OfflineAudioCtx) wrapAudio(OfflineAudioCtx.prototype);
  } catch (e) {}

  // =========================================================================
  // 4. HIJACKING — eval, redirects
  // (Rastreamento de rede agora é feito pelo background via webRequest API,
  //  que vê TODAS as requisições — não só fetch/XHR — e expõe o tipo de
  //  recurso. Removemos os hooks de fetch/XHR daqui para evitar duplicação.)
  // =========================================================================
  try {
    const origEval = window.eval;
    // Indirect eval. O Function constructor não é monitorado porque
    // frameworks JS (jQuery, Vue, React, GTM) o usam normalmente para
    // compilar templates — gera falso positivo demais.
    // eval() com strings curtas também tende a ser benigno (polyfills,
    // detecção de feature), então só sinalizamos código com tamanho
    // relevante.
    const EVAL_MIN_LEN = 50;
    window.eval = function (code) {
      if (typeof code === 'string' && code.length >= EVAL_MIN_LEN) {
        emit('hijacking', {
          type: 'eval()',
          codeLength: code.length,
          sample: code.slice(0, 80),
        });
      }
      return origEval.call(this, code);
    };
  } catch (e) {}

  // Detecta document.write injetando <script> dinamicamente — padrão clássico
  // de injeção de hook (BeEF, ad fraud, malvertising)
  try {
    const origWrite = document.write;
    document.write = function (markup) {
      try {
        if (typeof markup === 'string' && /<script\b/i.test(markup)) {
          emit('hijacking', {
            type: 'document.write injetando script',
            sample: markup.slice(0, 120),
          });
        }
      } catch (e) {}
      return origWrite.apply(this, arguments);
    };
  } catch (e) {}

  try {
    const origAssign = window.location.assign;
    const origReplace = window.location.replace;
    window.location.assign = function (url) {
      const dest = getDomain(url);
      if (dest && getBaseDomain(dest) !== mainBaseDomain) {
        emit('hijacking', { type: 'location.assign cross-domain', target: String(url) });
      }
      return origAssign.apply(this, arguments);
    };
    window.location.replace = function (url) {
      const dest = getDomain(url);
      if (dest && getBaseDomain(dest) !== mainBaseDomain) {
        emit('hijacking', { type: 'location.replace cross-domain', target: String(url) });
      }
      return origReplace.apply(this, arguments);
    };
  } catch (e) {}
})();
