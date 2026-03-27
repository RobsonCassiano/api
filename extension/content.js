// ==========================================
// CONTENT SCRIPT - FedEx PSDU Capture
// FILTRA APENAS: status "READY_TO_FINALIZE"
// ENDPOINT: /shipments?page=0&size=100&direction=DESC
// ==========================================

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

chrome.runtime.sendMessage({ type: 'GET_BACKEND_CONFIG' }, (response) => {
  injectPageScript(response?.backendBaseUrl || '');
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
