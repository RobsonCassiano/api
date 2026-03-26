// ==========================================
// CONTENT SCRIPT - FedEx PSDU Capture
// FILTRA APENAS: status "READY_TO_FINALIZE"
// ENDPOINT: /shipments?page=0&size=100&direction=DESC
// ==========================================

// === INJETAR SCRIPT NA PÁGINA (via arquivo externo - permite CSP) ===
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');

script.onload = function() {
  setTimeout(() => {
    try {
      script.remove();
    } catch(e) {
      console.warn('⚠️ Não foi possível remover script:', e);
    }
  }, 100);
};

script.onerror = function() {
  console.error('❌ Erro ao carregar injected.js. Verifique manifest.json web_accessible_resources');
  setTimeout(() => {
    try {
      script.remove();
    } catch(e) {
      console.warn('⚠️ Não foi possível remover script:', e);
    }
  }, 100);
};

// Append ao DOM
const target = document.head || document.documentElement;
if (target) {
  target.appendChild(script);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    if (document.head || document.documentElement) {
      (document.head || document.documentElement).appendChild(script);
    }
  });
}

console.log('%c✅ Content Script Carregado', 'background: #ff6600; color: white; padding: 3px 8px;');