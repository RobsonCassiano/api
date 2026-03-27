const FEDEX_COOKIE_URLS = [
  'https://www.fedex.com/shippingplus/pt-br/shipments-overview/all-shipments',
  'https://www.fedex.com/pt-br/home.html',
  'https://www.fedex.com/',
  'https://magicplus-magicplus.apps.az.fxei.fedex.com/'
];
const DEFAULT_BACKEND_BASE_URL = 'https://fedex-shipping-api.onrender.com';

function normalizeBackendBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getStoredBackendBaseUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get('backendBaseUrl', (data) => {
      const nextValue = normalizeBackendBaseUrl(data?.backendBaseUrl);
      resolve(nextValue || DEFAULT_BACKEND_BASE_URL);
    });
  });
}

function setStoredBackendBaseUrl(value) {
  return new Promise((resolve) => {
    const normalizedValue = normalizeBackendBaseUrl(value) || DEFAULT_BACKEND_BASE_URL;
    chrome.storage.local.set({ backendBaseUrl: normalizedValue }, () => {
      resolve(normalizedValue);
    });
  });
}

async function getFedexCookies() {
  const cookieMap = new Map();

  for (const url of FEDEX_COOKIE_URLS) {
    try {
      const cookies = await chrome.cookies.getAll({ url });
      cookies.forEach((cookie) => {
        const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
        if (!cookieMap.has(key)) {
          cookieMap.set(key, cookie);
        }
      });
    } catch (error) {
      console.warn('Erro ao consultar cookies para URL:', url, error);
    }
  }

  return Array.from(cookieMap.values());
}

async function isFedexLoggedIn() {
  try {
    const cookies = await getFedexCookies();

    const hasLoginCookie = cookies.some((c) =>
      c.name === 'sc_fcl_uuid' ||
      c.name === 'fcl_uuid' ||
      c.name === 'fdx_login' ||
      c.name === 'pwg' ||
      c.name === 'FEDEX_EID'
    );

    console.log('FedEx Login Check (Cookies):', hasLoginCookie, 'Cookies:', cookies.length);
    return hasLoginCookie;
  } catch (e) {
    console.error('Erro ao verificar login:', e);
    return false;
  }
}

function validateUserLogin(loginData) {
  if (!loginData) {
    console.log('Dados de login nao fornecidos');
    return false;
  }

  const hasUserLoggedIn = loginData.userLoggedIn === true;
  const hasUuId = loginData.uuId && loginData.uuId.length > 0;

  console.log('Validando login:', {
    userLoggedIn: hasUserLoggedIn,
    uuId: hasUuId,
    uuIdValue: loginData.uuId
  });

  return hasUserLoggedIn && hasUuId;
}

async function getFedexSession() {
  try {
    const cookies = await getFedexCookies();

    const uuidCookie = cookies.find((c) => c.name === 'sc_fcl_uuid')
      || cookies.find((c) => c.name === 'fcl_uuid');
    const loginCookie = cookies.find((c) => c.name === 'fdx_login');

    if (uuidCookie?.value) {
      return {
        userId: String(uuidCookie.value).trim(),
        key: null,
        value: null
      };
    }

    if (!loginCookie) {
      console.log('Cookies sc_fcl_uuid, fcl_uuid e fdx_login nao encontrados');
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(loginCookie.value);
    } catch (parseErr) {
      console.log('Cookie fdx_login nao e JSON, tentando valor direto');
      parsed = loginCookie.value;
    }

    if (typeof parsed === 'object' && parsed !== null) {
      return {
        userId: parsed.userId || null,
        key: parsed.account?.key || null,
        value: parsed.account?.value || null
      };
    }

    return {
      userId: parsed,
      key: null,
      value: null
    };
  } catch (e) {
    console.error('Erro em getFedexSession:', e);
    return null;
  }
}

/**
 * NOVO: Limpar dados sensíveis quando fazer logout
 * Chamado quando: usuário faz logout, sessão expira, etc
 */
function clearAllSensitiveData() {
  console.log('🧹 INICIANDO LIMPEZA COMPLETA DE DADOS SENSÍVEIS...');
  
  // Limpar chrome.storage.local
  chrome.storage.local.remove([
    'fedex_login_status',
    'userUuId',
    'sessionToken',
    'fedex_uuid',
    'fedex_user_session',
    'backendBaseUrl'
  ], () => {
    console.log('✅ chrome.storage.local limpo');
  });

  // Notificar TODAS as abas para limpar localStorage/sessionStorage
  chrome.tabs.query({}, (tabs) => {
    console.log(`📢 Enviando CLEAR_SENSITIVE_DATA para ${tabs.length} abas`);
    tabs.forEach((tab, index) => {
      chrome.tabs.sendMessage(tab.id, { 
        type: 'CLEAR_SENSITIVE_DATA' 
      }).then(() => {
        console.log(`✅ Aba ${index + 1}/${tabs.length} limpa (ID: ${tab.id})`);
      }).catch((err) => {
        console.warn(`⚠️ Erro ao limpar aba ${index + 1} (ID: ${tab.id}):`, err.message);
      });
    });
  });
  
  console.log('✅ LIMPEZA INICIADA');
}

/**
 * NOVO: Monitorar expiração de cookies de sessão FedEx
 * Detecta quando o usuário faz logout
 */
if (chrome.cookies) {
  chrome.cookies.onChanged.addListener((changeInfo) => {
    const cookie = changeInfo.cookie;
    
    // Se cookie de sessão FedEx foi removido = logout
    if ((cookie.name === 'sc_fcl_uuid' || 
         cookie.name === 'fcl_uuid' || 
         cookie.name === 'fdx_login') && 
        changeInfo.removed) {
      console.log('❌ Detectado logout do FedEx (cookie removido):', cookie.name);
      clearAllSensitiveData();
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  getStoredBackendBaseUrl().then((backendBaseUrl) => {
    chrome.storage.local.set({ backendBaseUrl });
  });
});

// 🔌 Função genérica para fazer fetch no backend
async function backendFetch(method, endpoint, body = null) {
  const backendUrl = await getStoredBackendBaseUrl();
  const url = `${backendUrl}${endpoint}`;
  
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    targetAddressSpace: 'private'
  };
  
  if (body && (method === 'PUT' || method === 'POST')) {
    options.body = JSON.stringify(body);
  }
  
  console.log(`📤 [backendFetch] ${method} ${url}`);
  
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);
  
  if (!response.ok) {
    console.error(`❌ [backendFetch] ${response.status}`, data);
    throw new Error(data?.error || `HTTP ${response.status}`);
  }
  
  console.log(`✅ [backendFetch] ${method} ${url}`);
  return data;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_FEDEX_LOGIN') {
    isFedexLoggedIn().then((loggedIn) => {
      console.log('Respondendo CHECK_FEDEX_LOGIN:', loggedIn);
      sendResponse({ loggedIn });
    }).catch((err) => {
      console.error('Erro na resposta:', err);
      sendResponse({ loggedIn: false });
    });
    return true;
  }

  if (msg.type === 'VALIDATE_USER_LOGIN') {
    const isValid = validateUserLogin(msg.data);
    console.log('Respondendo VALIDATE_USER_LOGIN:', isValid);

    if (isValid) {
      // NOVO: Add session expiração (2 horas)
      const SESSION_TIMEOUT = 2 * 60 * 60 * 1000;
      chrome.storage.local.set({
        fedex_login_status: {
          isLoggedIn: true,
          uuId: msg.data.uuId,
          timestamp: Date.now(),
          expiresAt: Date.now() + SESSION_TIMEOUT  // ← NOVO
        }
      }, () => {
        console.log('Status de login salvo (expira em 2h)');
      });
    } else {
      clearAllSensitiveData();  // ← NOVO: limpar invalid login
    }

    sendResponse({ isValid });
    return true;
  }

  if (msg.type === 'GET_LOGIN_STATUS') {
    chrome.storage.local.get('fedex_login_status', (data) => {
      const status = data.fedex_login_status || { isLoggedIn: false };
      
      // NOVO: Verificar expiração de sessão
      if (status.isLoggedIn && status.expiresAt && Date.now() > status.expiresAt) {
        console.log('⏰ Sessão expirou! Limpando dados...');
        clearAllSensitiveData();
        sendResponse({ isLoggedIn: false });
        return true;
      }
      
      console.log('Respondendo GET_LOGIN_STATUS:', status);
      sendResponse(status);
    });
    return true;
  }

  // NOVO: Handler para requisição de logout
  if (msg.type === 'USER_LOGOUT') {
    console.log('📴 Logout requisitado pelo usuário');
    clearAllSensitiveData();
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'GET_FEDEX_SESSION') {
    getFedexSession().then((session) => {
      console.log('Respondendo GET_FEDEX_SESSION:', session);
      sendResponse({ session });
    }).catch((err) => {
      console.error('Erro na resposta:', err);
      sendResponse({ session: null });
    });
    return true;
  }

  if (msg.type === 'GET_BACKEND_CONFIG') {
    getStoredBackendBaseUrl().then((backendBaseUrl) => {
      sendResponse({ backendBaseUrl });
    }).catch((err) => {
      console.error('Erro ao obter configuracao do backend:', err);
      sendResponse({ backendBaseUrl: DEFAULT_BACKEND_BASE_URL });
    });
    return true;
  }

  if (msg.type === 'SET_BACKEND_CONFIG') {
    setStoredBackendBaseUrl(msg.backendBaseUrl).then((backendBaseUrl) => {
      sendResponse({ ok: true, backendBaseUrl });
    }).catch((err) => {
      console.error('Erro ao salvar configuracao do backend:', err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }

  // 🌐 HANDLERS PARA REQUISIÇÕES DO BACKEND
  
  if (msg.type === 'FETCH_PRINT_PREFERENCE') {
    backendFetch('GET', `/api/v1/users/${encodeURIComponent(msg.userId)}/print-preferences`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'FETCH_FEDEX_SETTINGS') {
    backendFetch('GET', `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SAVE_PRINT_PREFERENCE') {
    backendFetch('PUT', `/api/v1/users/${encodeURIComponent(msg.userId)}/print-preferences`, msg.preference)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SAVE_FEDEX_SETTINGS') {
    backendFetch('PUT', `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings`, msg.settings)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SELECT_FEDEX_ACCOUNT') {
    backendFetch('PUT', `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings/select`, { accountNumber: msg.accountNumber })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'DELETE_FEDEX_SETTINGS') {
    backendFetch('DELETE', `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings/${encodeURIComponent(msg.accountNumber)}`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'FETCH_DRAFTS') {
    backendFetch('GET', '/api/v1/drafts')
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'CANCEL_SHIPMENT') {
    backendFetch('PUT', '/api/v1/fedex/shipments/cancel', {
      userId: msg.userId,
      accountNumber: msg.accountNumber,
      trackingNumber: msg.trackingNumber
    })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SAVE_DRAFT') {
    backendFetch('POST', '/api/v1/drafts/save', msg.draft)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SEND_DRAFT_TO_FEDEX') {
    backendFetch('POST', `/api/v1/drafts/${encodeURIComponent(msg.draftId)}/send-to-fedex`, msg.options || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'FETCH_ENCODED_DOCUMENTS') {
    backendFetch('GET', `/api/v1/drafts/${encodeURIComponent(msg.draftId)}/documents/encoded`)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
