// ==========================================
// CONTENT SCRIPT - FedEx PSDU Capture
// FILTRA APENAS: status "READY_TO_FINALIZE"
// ENDPOINT: /shipments?page=0&size=100&direction=DESC
// ==========================================

/**
 * NOVO: Monitorar logout na página
 * Detecta clique em botões de logout em qualquer página FedEx
 */
function monitorLogoutEvents() {
  // Detectar clique em botões de logout genéricos
  document.addEventListener('click', (event) => {
    const target = event.target;
    
    // Procurar atributos/classes comuns de logout
    const isLogoutButton = 
      target.textContent?.toLowerCase().includes('logout') ||
      target.textContent?.toLowerCase().includes('sair') ||
      target.textContent?.toLowerCase().includes('sign out') ||
      target.id?.toLowerCase().includes('logout') ||
      target.className?.toLowerCase().includes('logout') ||
      target.closest('[data-action="logout"]') ||
      target.closest('button[aria-label*="Logout"]') ||
      target.closest('button[aria-label*="Sign out"]');
    
    if (isLogoutButton) {
      console.log('🚨 Logout detectado! Sinalizando ao background...');
      chrome.runtime.sendMessage({ type: 'USER_LOGOUT' }).catch(() => {});
    }
  }, true);

  // Detectar mudanças de URL (redirecionamento para login = logout)
  let lastUrl = window.location.href;
  window.addEventListener('popstate', () => {
    if (window.location.href.includes('login') || window.location.href.includes('signin')) {
      console.log('🔄 Redirecionado para login (logout detectado)');
      chrome.runtime.sendMessage({ type: 'USER_LOGOUT' }).catch(() => {});
    }
    lastUrl = window.location.href;
  });
}

function injectPageScript(backendBaseUrl) {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.dataset.backendBaseUrl = String(backendBaseUrl || '').trim();

  script.onload = function() {
    setTimeout(() => {
      try {
        script.remove();
      } catch (e) {
        console.warn('Nao foi possivel remover script:', e);
      }
    }, 100);
  };

  script.onerror = function() {
    console.error('Erro ao carregar injected.js. Verifique manifest.json web_accessible_resources');
    setTimeout(() => {
      try {
        script.remove();
      } catch (e) {
        console.warn('Nao foi possivel remover script:', e);
      }
    }, 100);
  };

  const target = document.head || document.documentElement;
  if (target) {
    target.appendChild(script);
    return;
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.head || document.documentElement) {
      (document.head || document.documentElement).appendChild(script);
    }
  });
}

// NOVO: Listener para mensagens do background
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CLEAR_SENSITIVE_DATA') {
    console.log('📭 Limpando dados sensíveis do localStorage...');
    
    // Limpar localStorage
    try {
      localStorage.removeItem('fedexPsdPanelPosition');
      localStorage.removeItem('fedexPsdPanelUiState');
      localStorage.removeItem('fedex_user_session');
      localStorage.removeItem('fedex_uuid');
      sessionStorage.clear();
      console.log('✅ localStorage limpo');
    } catch (e) {
      console.warn('Não foi possível limpar localStorage:', e);
    }
    
    // Notificar página injetada
    window.postMessage({
      type: 'FEDEX_SESSION_CLEARED'
    }, '*');
    
    sendResponse({ success: true });
    return true;
  }
});

chrome.runtime.sendMessage({ type: 'GET_BACKEND_CONFIG' }, (response) => {
  injectPageScript(response?.backendBaseUrl || '');
  // NOVO: Iniciar monitoramento de logout
  monitorLogoutEvents();
});

window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return;
  }

  if (event.data?.type !== 'FEDEX_PSDU_GET_SESSION') {
    return;
  }

  chrome.runtime.sendMessage({ type: 'GET_FEDEX_SESSION' }, (response) => {
    window.postMessage({
      type: 'FEDEX_PSDU_SESSION_RESPONSE',
      requestId: event.data.requestId || null,
      session: response?.session || null
    }, '*');
  });
});

console.log('%cContent Script Carregado', 'background: #ff6600; color: white; padding: 3px 8px;');
