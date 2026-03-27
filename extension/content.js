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
      String(target.textContent || '').toLowerCase().includes('logout') ||
      String(target.textContent || '').toLowerCase().includes('sair') ||
      String(target.textContent || '').toLowerCase().includes('sign out') ||
      String(target.id || '').toLowerCase().includes('logout') ||
      String(target.className || '').toLowerCase().includes('logout') ||
      target.closest('[data-action="logout"]') ||
      target.closest('button[aria-label*="Logout"]') ||
      target.closest('button[aria-label*="Sign out"]');
    
    if (isLogoutButton) {
      console.log('🚨 Logout detectado! Sinalizando ao background...');
      chrome.runtime.sendMessage({ type: 'USER_LOGOUT' }).catch(() => {});
    }
  }, true);

  // Detectar mudanças de URL com monitor periódico
  let lastUrl = window.location.href;
  let logoutTriggered = false;
  
  const checkUrlForLogout = () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      if ((currentUrl.includes('login') || currentUrl.includes('signin') || currentUrl.includes('/home')) && !logoutTriggered) {
        console.log('🔄 Redirecionado para login/home (logout detectado)');
        logoutTriggered = true;
        chrome.runtime.sendMessage({ type: 'USER_LOGOUT' }).catch(() => {});
        setTimeout(() => { logoutTriggered = false; }, 2000);
      }
    }
  };
  
  window.addEventListener('popstate', checkUrlForLogout);
  window.addEventListener('hashchange', checkUrlForLogout);
  setInterval(checkUrlForLogout, 1000);
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

// NOVO: Bridge para mensagens da injected.js (window.postMessage -> chrome.runtime.sendMessage)
window.addEventListener('message', (event) => {
  // Verificar origem
  if (event.source !== window) {
    return;
  }

  // Verificar se é mensagem da injected.js
  if (!event.data?._fromInjected) {
    return;
  }

  // Lista de tipos permitidos que content.js encaminha para background.js
  const ALLOWED_MESSAGE_TYPES = [
    'FETCH_PRINT_PREFERENCE',
    'FETCH_FEDEX_SETTINGS',
    'SAVE_PRINT_PREFERENCE',
    'SAVE_FEDEX_SETTINGS',
    'SELECT_FEDEX_ACCOUNT',
    'DELETE_FEDEX_SETTINGS',
    'FETCH_DRAFTS',
    'CANCEL_SHIPMENT',
    'SAVE_DRAFT',
    'SEND_DRAFT_TO_FEDEX',
    'FETCH_ENCODED_DOCUMENTS'
  ];

  const messageType = event.data?.type;
  const requestId = event.data?.requestId;

  if (!ALLOWED_MESSAGE_TYPES.includes(messageType)) {
    console.warn(`⚠️ Tipo de mensagem nao permitido: ${messageType}`);
    return;
  }

  // Construir payload para background.js (sem campos internos)
  const payload = { ...event.data };
  delete payload._fromInjected;
  delete payload.requestId;

  console.log(`🌉 [content.js] Relayando mensagem do injected.js:`, messageType, 'requestId:', requestId);
  console.log(`🌉 [content.js] Payload detalhado:`, payload);

  // Encaminhar para background.js usando Promise para evitar "Extension context invalidated"
  try {
    chrome.runtime.sendMessage(payload, (response) => {
      try {
        // Verificar se o contexto ainda é válido antes de responder
        if (!window || !window.postMessage) {
          console.warn(`⚠️ [content.js] Contexto da janela não disponível para responder`);
          return;
        }

        console.log(`🌉 [content.js] Resposta recebida de background.js:`, messageType, response);
        
        // Retornar resposta para injected.js com o mesmo requestId
        window.postMessage(
          {
            ...response,
            requestId
          },
          '*'
        );
      } catch (error) {
        if (error.message?.includes('Extension context invalidated')) {
          console.warn(`⚠️ [content.js] Extension context invalidated - não foi possível enviar resposta`);
        } else {
          console.error(`❌ [content.js] Erro ao responder para injected.js:`, error);
        }
      }
    });
  } catch (error) {
    console.error(`❌ [content.js] Erro ao enviar mensagem para background.js:`, error);
  }
});

console.log('%cContent Script Carregado', 'background: #ff6600; color: white; padding: 3px 8px;');
