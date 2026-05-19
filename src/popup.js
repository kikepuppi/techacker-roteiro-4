/**
 * Popup Script - TechHacker Privacy Guardian
 * 
 * Lógica do popup que aparece quando o usuário clica no ícone da extensão
 */

console.log('[TechHacker Popup] Script iniciado');

let currentPageData = {};

/**
 * Obtém dados da página atual do background script
 */
async function loadPageData() {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    if (!currentTab) return;

    const data = await browser.runtime.sendMessage({
      type: 'GET_PAGE_DATA',
      tabId: currentTab.id,
    });

    currentPageData = data || {};
    console.log('[TechHacker Popup] Dados carregados:', currentPageData);

    updateUI();
  } catch (error) {
    console.error('[TechHacker Popup] Erro ao carregar dados:', error);
  }
}

/**
 * Atualiza a interface com os dados
 */
function updateUI() {
  // Atualiza Privacy Score
  const privacyScore = calculatePrivacyScore();
  document.getElementById('privacyScore').textContent = privacyScore;
  document.getElementById('scoreDescription').textContent = getScoreDescription(privacyScore);

  // Atualiza estatísticas
  document.getElementById('stat-third-party').textContent = 
    (currentPageData.thirdPartyDomains || []).length;
  document.getElementById('stat-cookies').textContent = 
    (currentPageData.cookies || []).length;
  document.getElementById('stat-fingerprint').textContent = 
    (currentPageData.fingerprinting || []).length;
  document.getElementById('stat-hijacking').textContent = 
    (currentPageData.hijackingAttempts || []).length;

  // Atualiza listas
  updateTrackingList();
  updateCookiesList();
  updateStorageList();
  updateFingerprintList();
  updateHijackingList();
}

/**
 * Calcula Privacy Score baseado em detecções
 */
function calculatePrivacyScore() {
  let score = 100;

  if (currentPageData.thirdPartyDomains) {
    score -= Math.min(currentPageData.thirdPartyDomains.length * 2, 30);
  }
  if (currentPageData.fingerprinting) {
    score -= Math.min(currentPageData.fingerprinting.length * 5, 30);
  }
  if (currentPageData.hijackingAttempts) {
    score -= Math.min(currentPageData.hijackingAttempts.length * 10, 25);
  }
  if (currentPageData.cookies) {
    score -= Math.min(currentPageData.cookies.length * 1, 20);
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Descrição textual do Privacy Score
 */
function getScoreDescription(score) {
  if (score >= 80) return 'Excelente - Página respeitosa com privacidade';
  if (score >= 60) return 'Bom - Alguns rastreadores detectados';
  if (score >= 40) return 'Razoável - Múltiplas ameaças à privacidade';
  if (score >= 20) return 'Ruim - Muitas ameaças detectadas';
  return 'Crítico - Página altamente invasiva';
}

/**
 * Atualiza lista de domínios de rastreamento
 */
function updateTrackingList() {
  const list = document.getElementById('tracking-list');
  const domains = currentPageData.thirdPartyDomains || [];

  if (domains.length === 0) {
    list.innerHTML = '<p class="empty-message">Nenhum rastreador detectado</p>';
    return;
  }

  // Remove duplicatas
  const uniqueDomains = [...new Set(domains.map(d => d.domain))];

  list.innerHTML = uniqueDomains.map(domain => `
    <div class="item">
      <div class="item-header">
        <span class="item-title">${domain}</span>
      </div>
      <div class="item-details">
        <span class="badge">3ª Parte</span>
      </div>
    </div>
  `).join('');
}

/**
 * Atualiza lista de cookies
 */
function updateCookiesList() {
  const list = document.getElementById('cookies-list');
  const cookies = currentPageData.cookies || [];

  if (cookies.length === 0) {
    list.innerHTML = '<p class="empty-message">Nenhum cookie detectado ainda</p>';
    return;
  }

  const partyLabel = (p) => (p === 'primeira' ? '1ª parte' : p === 'terceira' ? '3ª parte' : '?');

  list.innerHTML = cookies
    .map((cookie, index) => `
    <div class="item">
      <div class="item-header">
        <span class="item-title">${cookie.name || `Cookie ${index + 1}`}</span>
      </div>
      <div class="item-details">
        <span class="badge">${partyLabel(cookie.party)}</span>
        <span class="badge">${cookie.lifetime || '?'}</span>
        <span class="value">${cookie.domain || ''}</span>
      </div>
    </div>
  `)
    .join('');
}

/**
 * Atualiza lista de Web Storage
 */
function updateStorageList() {
  const list = document.getElementById('storage-list');
  const storage = currentPageData.localStorage || [];
  const sessionStorage = currentPageData.sessionStorage || [];

  const items = [...storage, ...sessionStorage];

  if (items.length === 0) {
    list.innerHTML = '<p class="empty-message">Nenhum dado em storage detectado</p>';
    return;
  }

  list.innerHTML = items.map((item, index) => `
    <div class="item">
      <div class="item-header">
        <span class="item-title">${item.key || `Storage ${index + 1}`}</span>
      </div>
      <div class="item-details">
        <span class="badge">${item.type || 'localStorage'}</span>
        <span class="value">${(item.size || 0)} bytes</span>
      </div>
    </div>
  `).join('');
}

/**
 * Atualiza lista de fingerprinting
 */
function updateFingerprintList() {
  const list = document.getElementById('fingerprint-list');
  const fingerprints = currentPageData.fingerprinting || [];

  if (fingerprints.length === 0) {
    list.innerHTML = '<p class="empty-message">Nenhuma tentativa de fingerprinting detectada</p>';
    return;
  }

  list.innerHTML = fingerprints.map((fp, index) => `
    <div class="item">
      <div class="item-header">
        <span class="item-title">${fp.method || `Fingerprint ${index + 1}`}</span>
      </div>
      <div class="item-details">
        <span class="time">${new Date(fp.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  `).join('');
}

/**
 * Atualiza lista de hijacking
 */
function updateHijackingList() {
  const list = document.getElementById('hijacking-list');
  const hijackings = currentPageData.hijackingAttempts || [];

  if (hijackings.length === 0) {
    list.innerHTML = '<p class="empty-message">Nenhuma ameaça de hijacking detectada</p>';
    return;
  }

  list.innerHTML = hijackings.map((hijack, index) => `
    <div class="item warning">
      <div class="item-header">
        <span class="item-title">${hijack.type || `Ameaça ${index + 1}`}</span>
      </div>
      <div class="item-details">
        <span class="time">${new Date(hijack.timestamp).toLocaleTimeString()}</span>
      </div>
    </div>
  `).join('');
}

/**
 * Sistema de abas
 */
function setupTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabPanes = document.querySelectorAll('.tab-pane');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      // Remove active de todos
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));

      // Adiciona active ao clicado
      button.classList.add('active');
      const tabName = button.getAttribute('data-tab');
      document.getElementById(tabName).classList.add('active');
    });
  });
}

/**
 * Recarrega dados a cada 2 segundos
 */
function startAutoRefresh() {
  setInterval(() => {
    loadPageData();
  }, 2000);
}

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  console.log('[TechHacker Popup] Página pronta');
  setupTabs();
  loadPageData();
  startAutoRefresh();
});
