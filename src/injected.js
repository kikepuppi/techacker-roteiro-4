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
  // 4. REDE — fetch e XMLHttpRequest (complemento ao webRequest do background)
  // =========================================================================
  try {
    const origFetch = window.fetch;
    window.fetch = function (input) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const reqDomain = getDomain(url);
        if (reqDomain && getBaseDomain(reqDomain) !== mainBaseDomain) {
          emit('thirdParty', { domain: reqDomain, type: 'fetch', url: String(url) });
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        const reqDomain = getDomain(url);
        if (reqDomain && getBaseDomain(reqDomain) !== mainBaseDomain) {
          emit('thirdParty', { domain: reqDomain, type: 'xhr', url: String(url) });
        }
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  } catch (e) {}

  // =========================================================================
  // 5. HIJACKING — eval, Function constructor, redirects
  // =========================================================================
  try {
    const origEval = window.eval;
    // O eval é especial: redefinir window.eval cria um "indirect eval" que
    // perde acesso ao escopo léxico do caller. Para nossa detecção isso é OK.
    window.eval = function (code) {
      if (typeof code === 'string' && code.length > 0) {
        emit('hijacking', { type: 'eval()', codeLength: code.length, sample: code.slice(0, 80) });
      }
      return origEval.call(this, code);
    };

    const origFunction = window.Function;
    window.Function = new Proxy(origFunction, {
      construct(target, args) {
        emit('hijacking', { type: 'new Function()', argCount: args.length });
        return new target(...args);
      },
      apply(target, thisArg, args) {
        emit('hijacking', { type: 'Function()', argCount: args.length });
        return target.apply(thisArg, args);
      },
    });
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
