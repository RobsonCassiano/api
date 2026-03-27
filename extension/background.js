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
  console.log('Limpando dados sensíveis da extensão...');
  
  // Limpar chrome.storage.local
  chrome.storage.local.remove([
    'fedex_login_status',
    'userUuId',
    'sessionToken'
  ], () => {
    console.log('Storage local limpo');
  });

  // Notificar todas as abas para limpar localStorage
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      chrome.tabs.sendMessage(tab.id, { 
        type: 'CLEAR_SENSITIVE_DATA' 
      }).catch(() => {
        // Silenciosamente ignorar erros se aba não tiver content script
      });
    });
  });
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
      console.log('Respondendo GET_LOGIN_STATUS:', status);
      sendResponse(status);
    })
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
    sendResponse({ success: true

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
});
