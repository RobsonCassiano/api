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
 * NOVO: Obter userId do contexto (cookies ou armazenamento)
 * Usado para validar userId nulo nas requisições de save
 */
async function getCurrentUserId() {
  try {
    const session = await getFedexSession();
    return session?.userId || null;
  } catch (error) {
    console.error('Erro ao obter userId:', error);
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
    headers: { 'Content-Type': 'application/json' }
  };
  
  // Apenas usar targetAddressSpace: 'private' para URLs de endereços privados (localhost, IPs locais)
  // URLs externas (render.com, etc) não devem ter essa opção
  if (backendUrl && (backendUrl.includes('localhost') || backendUrl.includes('127.0.0.1') || backendUrl.includes('192.168.'))) {
    options.targetAddressSpace = 'private';
  }
  
  if (body && (method === 'PUT' || method === 'POST')) {
    options.body = JSON.stringify(body);
  }
  
  console.log(`📤 [backendFetch] ${method} ${url}`);
  
  try {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => null);
    
    if (!response.ok) {
      console.error(`❌ [backendFetch] ${response.status}`, data);
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    
    console.log(`✅ [backendFetch] ${method} ${url}`);
    return data;
  } catch (error) {
    console.error(`❌ [backendFetch] Erro ao fazer fetch ${method} ${url}:`, error.message);
    throw error;
  }
}

// 🛡️ Wrapper para sendResponse seguro (trata "Extension context invalidated")
function safeResponse(sendResponse, response) {
  try {
    sendResponse(response);
  } catch (error) {
    if (error.message?.includes('Extension context invalidated')) {
      console.warn(`⚠️ [background.js] Extension context invalidated - não foi possível enviar resposta`);
    } else {
      console.error(`❌ [background.js] Erro ao enviar resposta:`, error);
    }
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log(`📨 [background.js] Mensagem recebida:`, msg.type, msg);

  if (msg.type === 'CHECK_FEDEX_LOGIN') {
    isFedexLoggedIn().then((loggedIn) => {
      console.log('Respondendo CHECK_FEDEX_LOGIN:', loggedIn);
      safeResponse(sendResponse, { loggedIn });
    }).catch((err) => {
      console.error('Erro na resposta:', err);
      safeResponse(sendResponse, { loggedIn: false });
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

    safeResponse(sendResponse, { isValid });
    return true;
  }

  if (msg.type === 'GET_LOGIN_STATUS') {
    chrome.storage.local.get('fedex_login_status', (data) => {
      const status = data.fedex_login_status || { isLoggedIn: false };
      
      // NOVO: Verificar expiração de sessão
      if (status.isLoggedIn && status.expiresAt && Date.now() > status.expiresAt) {
        console.log('⏰ Sessão expirou! Limpando dados...');
        clearAllSensitiveData();
        safeResponse(sendResponse, { isLoggedIn: false });
        return true;
      }
      
      console.log('Respondendo GET_LOGIN_STATUS:', status);
      safeResponse(sendResponse, status);
    });
    return true;
  }

  // NOVO: Handler para requisição de logout
  if (msg.type === 'USER_LOGOUT') {
    console.log('📴 Logout requisitado pelo usuário');
    clearAllSensitiveData();
    safeResponse(sendResponse, { success: true });
    return true;
  }

  if (msg.type === 'GET_FEDEX_SESSION') {
    getFedexSession().then((session) => {
      console.log('Respondendo GET_FEDEX_SESSION:', session);
      safeResponse(sendResponse, { session });
    }).catch((err) => {
      console.error('Erro na resposta:', err);
      safeResponse(sendResponse, { session: null });
    });
    return true;
  }

  if (msg.type === 'GET_BACKEND_CONFIG') {
    getStoredBackendBaseUrl().then((backendBaseUrl) => {
      safeResponse(sendResponse, { backendBaseUrl });
    }).catch((err) => {
      console.error('Erro ao obter configuracao do backend:', err);
      safeResponse(sendResponse, { backendBaseUrl: DEFAULT_BACKEND_BASE_URL });
    });
    return true;
  }

  if (msg.type === 'SET_BACKEND_CONFIG') {
    setStoredBackendBaseUrl(msg.backendBaseUrl).then((backendBaseUrl) => {
      safeResponse(sendResponse, { ok: true, backendBaseUrl });
    }).catch((err) => {
      console.error('Erro ao salvar configuracao do backend:', err);
      safeResponse(sendResponse, { ok: false, error: err.message });
    });
    return true;
  }

  // 🌐 HANDLERS PARA REQUISIÇÕES DO BACKEND
  
  if (msg.type === 'FETCH_PRINT_PREFERENCE') {
    console.log(`📥 [background.js] FETCH_PRINT_PREFERENCE, userId:`, msg.userId);
    backendFetch('GET', `/api/v1/users/${encodeURIComponent(msg.userId)}/print-preferences`)
      .then((data) => {
        console.log(`✅ [background.js] FETCH_PRINT_PREFERENCE sucesso, respondendo`);
        safeResponse(sendResponse, { ok: true, data });
      })
      .catch((err) => {
        console.error(`❌ [background.js] FETCH_PRINT_PREFERENCE erro:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'FETCH_FEDEX_SETTINGS') {
    (async () => {
      try {
        console.log(`📥 [FETCH_FEDEX_SETTINGS] Handler iniciado`);
        console.log(`📥 [FETCH_FEDEX_SETTINGS] msg.userId: ${msg.userId}`);
        
        if (!msg.userId) {
          console.error(`❌ [FETCH_FEDEX_SETTINGS] userId não informado`);
          safeResponse(sendResponse, { ok: false, error: 'userId nao informado' });
          return;
        }
        
        const endpoint = `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings`;
        console.log(`📥 [FETCH_FEDEX_SETTINGS] Endpoint: ${endpoint}`);
        console.log(`📥 [FETCH_FEDEX_SETTINGS] Executando GET...`);
        
        const data = await backendFetch('GET', endpoint);
        
        console.log(`✅ [FETCH_FEDEX_SETTINGS] Dados carregados:`, {
          configured: data?.configured,
          accountsCount: data?.accounts?.length,
          selectedAccountNumber: data?.selectedAccountNumber
        });
        
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        console.error(`❌ [FETCH_FEDEX_SETTINGS] Erro ao carregar:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'SAVE_PRINT_PREFERENCE') {
    (async () => {
      try {
        const userId = msg.userId || await getCurrentUserId();
        if (!userId) {
          safeResponse(sendResponse, { ok: false, error: 'Usuario nao identificado' });
          return;
        }
        const data = await backendFetch('PUT', `/api/v1/users/${encodeURIComponent(userId)}/print-preferences`, msg.preference);
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'SAVE_FEDEX_SETTINGS') {
    (async () => {
      try {
        console.log(`💾 [SAVE_FEDEX_SETTINGS] Handler iniciado`);
        console.log(`💾 [SAVE_FEDEX_SETTINGS] msg.userId: ${msg.userId}, msg.settings:`, msg.settings);
        
        const userId = msg.userId || await getCurrentUserId();
        console.log(`💾 [SAVE_FEDEX_SETTINGS] userId resolvido: ${userId}`);
        
        if (!userId) {
          console.error(`❌ [SAVE_FEDEX_SETTINGS] Usuario nao identificado`);
          safeResponse(sendResponse, { ok: false, error: 'Usuario nao identificado' });
          return;
        }
        
        if (!msg.settings || typeof msg.settings !== 'object') {
          console.error(`❌ [SAVE_FEDEX_SETTINGS] Configurações inválidas:`, msg.settings);
          safeResponse(sendResponse, { ok: false, error: 'Configurações inválidas' });
          return;
        }
        
        const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/fedex-settings`;
        console.log(`💾 [SAVE_FEDEX_SETTINGS] Endpoint: ${endpoint}`);
        console.log(`💾 [SAVE_FEDEX_SETTINGS] Enviando para backend...`);
        
        const data = await backendFetch('PUT', endpoint, msg.settings);
        
        console.log(`✅ [SAVE_FEDEX_SETTINGS] Configurações salvas no backend:`, data);
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        console.error(`❌ [SAVE_FEDEX_SETTINGS] Erro ao salvar:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'SELECT_FEDEX_ACCOUNT') {
    (async () => {
      try {
        console.log(`⚙️ [SELECT_FEDEX_ACCOUNT] Handler iniciado`);
        console.log(`⚙️ [SELECT_FEDEX_ACCOUNT] msg.userId: ${msg.userId}, accountNumber: ${msg.accountNumber}`);
        
        const userId = msg.userId || await getCurrentUserId();
        console.log(`⚙️ [SELECT_FEDEX_ACCOUNT] userId resolvido: ${userId}`);
        
        if (!userId) {
          console.error(`❌ [SELECT_FEDEX_ACCOUNT] Usuario nao identificado`);
          safeResponse(sendResponse, { ok: false, error: 'Usuario nao identificado' });
          return;
        }
        
        if (!msg.accountNumber) {
          console.error(`❌ [SELECT_FEDEX_ACCOUNT] accountNumber não informado`);
          safeResponse(sendResponse, { ok: false, error: 'accountNumber nao informado' });
          return;
        }
        
        const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/fedex-settings/select`;
        const payload = { accountNumber: msg.accountNumber };
        console.log(`⚙️ [SELECT_FEDEX_ACCOUNT] Endpoint: ${endpoint}, payload:`, payload);
        console.log(`⚙️ [SELECT_FEDEX_ACCOUNT] Enviando para backend...`);
        
        const data = await backendFetch('PUT', endpoint, payload);
        
        console.log(`✅ [SELECT_FEDEX_ACCOUNT] Conta selecionada no backend:`, data);
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        console.error(`❌ [SELECT_FEDEX_ACCOUNT] Erro ao selecionar:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'SAVE_FEDEX_ACCOUNT') {
    (async () => {
      try {
        console.log('💾 [SAVE_FEDEX_ACCOUNT] Handler iniciado');
        
        const { userId, accountData } = msg;
        
        if (!userId || !accountData) {
          console.error('❌ [SAVE_FEDEX_ACCOUNT] Dados incompletos');
          safeResponse(sendResponse, { ok: false, error: 'Dados incompletos' });
          return;
        }
        
        console.log('💾 [SAVE_FEDEX_ACCOUNT] userId:', userId);
        console.log('📤 [SAVE_FEDEX_ACCOUNT] Payload:', JSON.stringify(accountData));
        
        const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/fedex-accounts`;
        console.log('📥 [SAVE_FEDEX_ACCOUNT] Endpoint: POST ' + endpoint);
        
        const response = await backendFetch('POST', endpoint, accountData);
        
        console.log('✅ [SAVE_FEDEX_ACCOUNT] Nova conta criada:', {
          accountNumber: response.accountNumber,
          nickname: response.nickname,
          accountType: response.accountType
        });
        
        safeResponse(sendResponse, { 
          ok: true, 
          data: response,
          message: 'Conta registrada com sucesso'
        });
      } catch (err) {
        console.error('❌ [SAVE_FEDEX_ACCOUNT] Erro ao salvar:', err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  } else if (msg.type === 'DELETE_FEDEX_ACCOUNT') {
    (async () => {
      try {
        console.log('🗑️ [DELETE_FEDEX_ACCOUNT] Handler iniciado');
        
        const { userId, accountNumber } = msg;
        
        if (!userId || !accountNumber) {
          console.error('🗑️ [DELETE_FEDEX_ACCOUNT] Dados incompletos');
          safeResponse(sendResponse, { ok: false, error: 'Dados incompletos' });
          return;
        }
        
        console.log('🗑️ [DELETE_FEDEX_ACCOUNT] userId:', userId);
        console.log('🗑️ [DELETE_FEDEX_ACCOUNT] accountNumber:', accountNumber);
        
        const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/fedex-accounts/${encodeURIComponent(accountNumber)}`;
        console.log('📥 [DELETE_FEDEX_ACCOUNT] Endpoint: DELETE ' + endpoint);
        
        const response = await backendFetch('DELETE', endpoint);
        
        console.log('✅ [DELETE_FEDEX_ACCOUNT] Conta deletada com sucesso:', {
          accountNumber,
          message: response.message
        });
        
        safeResponse(sendResponse, { 
          ok: true, 
          data: response,
          message: 'Conta deletada com sucesso'
        });
      } catch (err) {
        console.error('❌ [DELETE_FEDEX_ACCOUNT] Erro ao deletar:', err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  } else if (msg.type === 'FETCH_ACCOUNT_PREFERENCES') {
    (async () => {
      try {
        console.log('📋 [FETCH_ACCOUNT_PREFERENCES] Handler iniciado');
        
        const { userId, accountNumber } = msg;
        
        if (!userId || !accountNumber) {
          console.error('❌ [FETCH_ACCOUNT_PREFERENCES] Dados incompletos');
          safeResponse(sendResponse, { ok: false, error: 'Dados incompletos' });
          return;
        }
        
        console.log('📋 [FETCH_ACCOUNT_PREFERENCES] userId:', userId);
        console.log('📋 [FETCH_ACCOUNT_PREFERENCES] accountNumber:', accountNumber);
        
        const endpoint = `/api/v1/users/${encodeURIComponent(userId)}/fedex-accounts/${encodeURIComponent(accountNumber)}/preferences`;
        console.log('📥 [FETCH_ACCOUNT_PREFERENCES] Endpoint: GET ' + endpoint);
        
        const data = await backendFetch('GET', endpoint);
        
        console.log('✅ [FETCH_ACCOUNT_PREFERENCES] Preferências carregadas:', {
          printMode: data.printMode,
          defaultLabel: data.defaultLabel,
          autoRetry: data.autoRetry
        });
        
        safeResponse(sendResponse, { 
          ok: true, 
          data: data
        });
      } catch (err) {
        console.error('❌ [FETCH_ACCOUNT_PREFERENCES] Erro ao carregar:', err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  } else if (msg.type === 'FETCH_CANCELABLE_SHIPMENTS') {
    (async () => {
      try {
        console.log('📦 [FETCH_CANCELABLE_SHIPMENTS] Handler iniciado');
        
        const { userId, accountNumber } = msg;
        
        if (!userId) {
          console.error('❌ [FETCH_CANCELABLE_SHIPMENTS] UserId não informado');
          safeResponse(sendResponse, { ok: false, error: 'UserId não informado' });
          return;
        }
        
        console.log('📦 [FETCH_CANCELABLE_SHIPMENTS] userId:', userId);
        if (accountNumber) {
          console.log('📦 [FETCH_CANCELABLE_SHIPMENTS] accountNumber:', accountNumber);
        }
        
        const endpoint = accountNumber 
          ? `/api/v1/users/${encodeURIComponent(userId)}/shipments?accountNumber=${encodeURIComponent(accountNumber)}&cancelable=true`
          : `/api/v1/users/${encodeURIComponent(userId)}/shipments?cancelable=true`;
        
        console.log('📥 [FETCH_CANCELABLE_SHIPMENTS] Endpoint: GET ' + endpoint);
        
        const data = await backendFetch('GET', endpoint);
        
        console.log('✅ [FETCH_CANCELABLE_SHIPMENTS] Shipments carregados:', {
          count: data?.shipments?.length || 0
        });
        
        safeResponse(sendResponse, { 
          ok: true, 
          data: data
        });
      } catch (err) {
        console.error('❌ [FETCH_CANCELABLE_SHIPMENTS] Erro ao carregar:', err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'DELETE_FEDEX_SETTINGS') {
    (async () => {
      try {
        console.log(`🗑️ [DELETE_FEDEX_SETTINGS] Handler iniciado`);
        console.log(`🗑️ [DELETE_FEDEX_SETTINGS] msg.userId: ${msg.userId}, accountNumber: ${msg.accountNumber}`);
        
        if (!msg.userId || !msg.accountNumber) {
          console.error(`❌ [DELETE_FEDEX_SETTINGS] Parâmetros inválidos`);
          safeResponse(sendResponse, { ok: false, error: 'userId ou accountNumber nao informado' });
          return;
        }
        
        const endpoint = `/api/v1/users/${encodeURIComponent(msg.userId)}/fedex-settings/${encodeURIComponent(msg.accountNumber)}`;
        console.log(`🗑️ [DELETE_FEDEX_SETTINGS] Endpoint: ${endpoint}`);
        console.log(`🗑️ [DELETE_FEDEX_SETTINGS] Enviando para backend...`);
        
        const data = await backendFetch('DELETE', endpoint);
        
        console.log(`✅ [DELETE_FEDEX_SETTINGS] Conta deletada no backend:`, data);
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        console.error(`❌ [DELETE_FEDEX_SETTINGS] Erro ao deletar:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'FETCH_DRAFTS') {
    console.log(`📥 [background.js] FETCH_DRAFTS`);
    backendFetch('GET', '/api/v1/drafts')
      .then((data) => {
        console.log(`✅ [background.js] FETCH_DRAFTS sucesso, respondendo`);
        safeResponse(sendResponse, { ok: true, data });
      })
      .catch((err) => {
        console.error(`❌ [background.js] FETCH_DRAFTS erro:`, err.message);
        safeResponse(sendResponse, { ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'CANCEL_SHIPMENT') {
    (async () => {
      try {
        const userId = msg.userId || await getCurrentUserId();
        if (!userId) {
          safeResponse(sendResponse, { ok: false, error: 'Usuario nao identificado' });
          return;
        }
        const data = await backendFetch('PUT', '/api/v1/fedex/shipments/cancel', {
          userId,
          accountNumber: msg.accountNumber,
          trackingNumber: msg.trackingNumber
        });
        safeResponse(sendResponse, { ok: true, data });
      } catch (err) {
        safeResponse(sendResponse, { ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === 'SAVE_DRAFT') {
    backendFetch('POST', '/api/v1/drafts/save', msg.draft)
      .then((data) => safeResponse(sendResponse, { ok: true, data }))
      .catch((err) => safeResponse(sendResponse, { ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'SEND_DRAFT_TO_FEDEX') {
    backendFetch('POST', `/api/v1/drafts/${encodeURIComponent(msg.draftId)}/send-to-fedex`, msg.options || {})
      .then((data) => safeResponse(sendResponse, { ok: true, data }))
      .catch((err) => safeResponse(sendResponse, { ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'FETCH_ENCODED_DOCUMENTS') {
    backendFetch('GET', `/api/v1/drafts/${encodeURIComponent(msg.draftId)}/documents/encoded`)
      .then((data) => safeResponse(sendResponse, { ok: true, data }))
      .catch((err) => safeResponse(sendResponse, { ok: false, error: err.message }));
    return true;
  }
});
