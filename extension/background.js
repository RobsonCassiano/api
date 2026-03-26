// background.js

async function isFedexLoggedIn() {
  try {
    const cookies = await chrome.cookies.getAll({
      url: 'https://www.fedex.com/'
    });

    // Verifica múltiplos cookies que indicam login
    const hasLoginCookie = cookies.some(c =>
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

// Valida se o usuário está realmente logado verificando dados específicos
function validateUserLogin(loginData) {
  if (!loginData) {
    console.log('❌ Dados de login não fornecidos');
    return false;
  }

  const hasUserLoggedIn = loginData.userLoggedIn === true;
  const hasUuId = loginData.uuId && loginData.uuId.length > 0;

  console.log('🔍 Validando login:', {
    userLoggedIn: hasUserLoggedIn,
    uuId: hasUuId,
    uuIdValue: loginData.uuId
  });

  return hasUserLoggedIn && hasUuId;
}

async function getFedexSession() {
  try {
    const cookies = await chrome.cookies.getAll({
      url: 'https://www.fedex.com/'
    });

    const loginCookie = cookies.find(c => c.name === 'fdx_login');

    if (!loginCookie) {
      console.log('Cookie fdx_login não encontrado');
      return null;
    }

    // Tentar fazer parse se for JSON
    let parsed;
    try {
      parsed = JSON.parse(loginCookie.value);
    } catch (parseErr) {
      console.log('Cookie fdx_login não é JSON, tentando valor direto');
      // Se não for JSON, usar o valor direto
      parsed = loginCookie.value;
    }

    // Retornar de forma segura
    if (typeof parsed === 'object' && parsed !== null) {
      return {
        userId: parsed.userId || null,
        key: parsed.account?.key || null,
        value: parsed.account?.value || null
      };
    }

    // Se for string simples
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'CHECK_FEDEX_LOGIN') {
    isFedexLoggedIn().then(loggedIn => {
      console.log('Respondendo CHECK_FEDEX_LOGIN:', loggedIn);
      sendResponse({ loggedIn });
    }).catch(err => {
      console.error('Erro na resposta:', err);
      sendResponse({ loggedIn: false });
    });
    return true;
  }

  if (msg.type === 'VALIDATE_USER_LOGIN') {
    // Recebe dados de login do content script
    const isValid = validateUserLogin(msg.data);
    console.log('Respondendo VALIDATE_USER_LOGIN:', isValid);

    // Salvar o estado de login em storage
    if (isValid) {
      chrome.storage.local.set({
        'fedex_login_status': {
          isLoggedIn: true,
          uuId: msg.data.uuId,
          timestamp: Date.now()
        }
      }, () => {
        console.log('✅ Status de login salvo em storage');
      });
    } else {
      chrome.storage.local.set({
        'fedex_login_status': {
          isLoggedIn: false,
          timestamp: Date.now()
        }
      });
    }

    sendResponse({ isValid });
    return true;
  }

  if (msg.type === 'GET_LOGIN_STATUS') {
    // Retorna o status de login salvo em storage
    chrome.storage.local.get('fedex_login_status', (data) => {
      const status = data.fedex_login_status || { isLoggedIn: false };
      console.log('Respondendo GET_LOGIN_STATUS:', status);
      sendResponse(status);
    });
    return true;
  }

  if (msg.type === 'GET_FEDEX_SESSION') {
    getFedexSession().then(session => {
      console.log('Respondendo GET_FEDEX_SESSION:', session);
      sendResponse({ session });
    }).catch(err => {
      console.error('Erro na resposta:', err);
      sendResponse({ session: null });
    });
    return true;
  }
});
