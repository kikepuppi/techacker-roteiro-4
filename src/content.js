/**
 * Content Script - TechHacker Privacy Guardian
 * 
 * Este script é injetado em TODA página visitada e:
 * - Monitora requisições de rede
 * - Detecta tentativas de fingerprinting
 * - Detecta hijacking
 * - Coleta dados de cookies e storage
 */

console.log('[TechHacker Content] Script iniciado em:', window.location.href);

// Extrai domínio da URL
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return null;
  }
}

// Domínio da página atual
const mainDomain = getDomain(window.location.href);

// Notifica background que a página carregou
browser.runtime.sendMessage({
  type: 'PAGE_LOADED',
  data: {
    url: window.location.href,
    timestamp: new Date().toISOString()
  }
});

// ============================================================
// 1. DETECÇÃO DE FINGERPRINTING
// ============================================================

console.log('[TechHacker] Iniciando monitoramento de fingerprinting...');

// Monitora Canvas API
const originalCanvasToDataURL = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(...args) {
  const stack = new Error().stack;
  const caller = stack.split('\n')[2];
  
  browser.runtime.sendMessage({
    type: 'ADD_FINGERPRINT',
    data: {
      method: 'Canvas.toDataURL',
      caller: caller,
      timestamp: new Date().toISOString()
    }
  });
  
  return originalCanvasToDataURL.apply(this, args);
};

// Monitora Canvas getImageData
const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
CanvasRenderingContext2D.prototype.getImageData = function(...args) {
  browser.runtime.sendMessage({
    type: 'ADD_FINGERPRINT',
    data: {
      method: 'Canvas.getImageData',
      timestamp: new Date().toISOString()
    }
  });
  
  return originalGetImageData.apply(this, args);
};

// Monitora WebGL
try {
  const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(pname) {
    if (pname === 37445) { // WEBGL_debug_renderer_info
      browser.runtime.sendMessage({
        type: 'ADD_FINGERPRINT',
        data: {
          method: 'WebGL.getParameter (RENDERER_INFO)',
          timestamp: new Date().toISOString()
        }
      });
    }
    return originalGetParameter.call(this, pname);
  };
} catch (e) {
  console.log('[TechHacker] WebGL não disponível');
}

// Monitora AudioContext
try {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (AudioContext) {
    const originalCreateOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function() {
      browser.runtime.sendMessage({
        type: 'ADD_FINGERPRINT',
        data: {
          method: 'AudioContext.createOscillator',
          timestamp: new Date().toISOString()
        }
      });
      return originalCreateOscillator.call(this);
    };
  }
} catch (e) {
  console.log('[TechHacker] AudioContext não disponível');
}

// ============================================================
// 2. DETECÇÃO DE HIJACKING
// ============================================================

console.log('[TechHacker] Iniciando monitoramento de hijacking...');

// Monitora mudanças em window.location
const originalLocationReplace = window.location.replace;
Object.defineProperty(window, 'location', {
  set: function(value) {
    browser.runtime.sendMessage({
      type: 'ADD_HIJACKING',
      data: {
        type: 'location.replace',
        newLocation: value,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Monitora mudanças no DOM perigosas (eval, dynamic scripts)
const originalEval = window.eval;
window.eval = function(code) {
  if (code && code.length > 0) {
    browser.runtime.sendMessage({
      type: 'ADD_HIJACKING',
      data: {
        type: 'eval() chamado',
        codeLength: code.length,
        timestamp: new Date().toISOString()
      }
    });
  }
  return originalEval.apply(this, arguments);
};

// ============================================================
// 3. MONITORAMENTO DE REQUISIÇÕES
// ============================================================

console.log('[TechHacker] Monitoramento de requisições iniciado');

// Função para extrair domínio base (ex: google.com de www.google.com)
function getBaseDomain(domain) {
  const parts = domain.split('.');
  if (parts.length >= 2) {
    return parts.slice(-2).join('.');
  }
  return domain;
}

// Hook fetch API
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const url = args[0];
  if (url) {
    const requestDomain = getDomain(url);
    const requestBaseDomain = getBaseDomain(requestDomain);
    const mainBaseDomain = getBaseDomain(mainDomain);

    if (requestBaseDomain !== mainBaseDomain && requestDomain) {
      browser.runtime.sendMessage({
        type: 'ADD_THIRD_PARTY',
        data: {
          domain: requestDomain,
          type: 'fetch',
          url: url,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  return originalFetch.apply(this, arguments);
};

// Hook XMLHttpRequest
const originalOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  if (url) {
    const requestDomain = getDomain(url);
    const requestBaseDomain = getBaseDomain(requestDomain);
    const mainBaseDomain = getBaseDomain(mainDomain);

    if (requestBaseDomain !== mainBaseDomain && requestDomain) {
      browser.runtime.sendMessage({
        type: 'ADD_THIRD_PARTY',
        data: {
          domain: requestDomain,
          type: 'XHR',
          url: url,
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  return originalOpen.apply(this, [method, url, ...rest]);
};

console.log('[TechHacker Content] Monitoramento completo iniciado');
