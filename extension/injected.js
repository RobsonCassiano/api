(function () {
  console.log('%cFedEx Interceptor iniciando...', 'color: #ff6600; font-weight: bold;');

  const configuredScript = document.currentScript;
  const originalFetch = window.fetch;
  const DEFAULT_BACKEND_BASE_URL = 'https://fedex-shipping-api.onrender.com';
  const BACKEND_BASE_URL = String(
    configuredScript?.dataset?.backendBaseUrl || DEFAULT_BACKEND_BASE_URL
  ).trim().replace(/\/+$/, '') || DEFAULT_BACKEND_BASE_URL;
  const DEFAULT_PRINT_PREFERENCE = {
    labelFormat: 'laser',
    autoOpenDocuments: true,
    additionalDocsFormat: 'laser'
  };
  const DEFAULT_FEDEX_SETTINGS = {
    configured: false,
    selectedAccountNumber: '',
    accounts: [],
    selectedAccount: null
  };
  const PANEL_POSITION_STORAGE_KEY = 'fedexPsdPanelPosition';
  const PANEL_UI_STATE_STORAGE_KEY = 'fedexPsdPanelUiState';
  const uiState = {
    currentUserId: null,
    printPreference: { ...DEFAULT_PRINT_PREFERENCE },
    fedexSettings: { ...DEFAULT_FEDEX_SETTINGS },
    fedexSettingsMode: 'summary',
    cancelableShipments: [],
    selectedCancellationTracking: '',
    backendStatus: {
      source: BACKEND_BASE_URL,
      lastSyncOk: false,
      lastSyncMessage: 'Aguardando sincronizacao'
    }
  };

  // 🌉 Helper para comunicação com background.js via content.js
  // Usa window.postMessage() sem chrome API (seguro para página injetada)
  function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      console.log(`📤 [injected.js] Enviando mensagem:`, message.type, 'requestId:', requestId);
      
      let timeoutId;
      let handler;
      let isResolved = false;

      timeoutId = setTimeout(() => {
        if (isResolved) return;
        isResolved = true;
        
        try {
          window.removeEventListener('message', handler);
        } catch (e) {
          console.warn('Erro ao remover listener:', e);
        }
        
        reject(new Error(`Request timeout: ${message.type}`));
      }, 10000);

      handler = (event) => {
        try {
          if (event.source !== window) return;
          if (event.data?.requestId !== requestId) return;

          if (isResolved) return;
          isResolved = true;

          window.removeEventListener('message', handler);
          clearTimeout(timeoutId);

          console.log(`📥 [injected.js] Resposta recebida:`, message.type, event.data);

          if (event.data?.error) {
            reject(new Error(event.data.error));
          } else {
            resolve(event.data);
          }
        } catch (error) {
          console.error(`❌ [injected.js] Erro ao processar resposta:`, error);
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        }
      };

      try {
        window.addEventListener('message', handler);
        window.postMessage({ ...message, requestId, _fromInjected: true }, '*');
      } catch (error) {
        console.error(`❌ [injected.js] Erro ao enviar mensagem:`, error);
        isResolved = true;
        reject(error);
      }
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function loadSavedPanelPosition() {
    try {
      const raw = window.localStorage.getItem(PANEL_POSITION_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (typeof parsed?.left !== 'number' || typeof parsed?.top !== 'number') {
        return null;
      }

      return parsed;
    } catch (error) {
      console.warn('[FedEx PSDU] Nao foi possivel carregar posicao salva do painel', error);
      return null;
    }
  }

  function savePanelPosition(position) {
    try {
      window.localStorage.setItem(PANEL_POSITION_STORAGE_KEY, JSON.stringify(position));
    } catch (error) {
      console.warn('[FedEx PSDU] Nao foi possivel salvar posicao do painel', error);
    }
  }

  function loadPanelUiState() {
    try {
      const raw = window.localStorage.getItem(PANEL_UI_STATE_STORAGE_KEY);
      if (!raw) {
        return {
          minimized: false,
          closed: false
        };
      }

      return {
        minimized: false,
        closed: false,
        ...JSON.parse(raw)
      };
    } catch (error) {
      console.warn('[FedEx PSDU] Nao foi possivel carregar estado da interface', error);
      return {
        minimized: false,
        closed: false
      };
    }
  }

  function savePanelUiState(nextState) {
    try {
      window.localStorage.setItem(PANEL_UI_STATE_STORAGE_KEY, JSON.stringify(nextState));
    } catch (error) {
      console.warn('[FedEx PSDU] Nao foi possivel salvar estado da interface', error);
    }
  }

  function applyPanelPosition(panel, position) {
    if (!panel || !position) {
      return;
    }

    const maxLeft = Math.max(window.innerWidth - panel.offsetWidth - 8, 8);
    const maxTop = Math.max(window.innerHeight - panel.offsetHeight - 8, 8);
    const left = clamp(position.left, 8, maxLeft);
    const top = clamp(position.top, 8, maxTop);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
  }

  function enablePanelDragging(panel, handle) {
    if (!panel || !handle) {
      return;
    }

    let dragState = null;

    const stopDragging = () => {
      if (!dragState) {
        return;
      }

      savePanelPosition({
        left: parseInt(panel.style.left, 10) || 8,
        top: parseInt(panel.style.top, 10) || 8
      });

      dragState = null;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stopDragging);
    };

    const onPointerMove = (event) => {
      if (!dragState) {
        return;
      }

      const maxLeft = Math.max(window.innerWidth - panel.offsetWidth - 8, 8);
      const maxTop = Math.max(window.innerHeight - panel.offsetHeight - 8, 8);
      const left = clamp(event.clientX - dragState.offsetX, 8, maxLeft);
      const top = clamp(event.clientY - dragState.offsetY, 8, maxTop);

      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.right = 'auto';
    };

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }

      if (event.target instanceof Element && event.target.closest('button')) {
        return;
      }

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top
      };

      handle.setPointerCapture?.(event.pointerId);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', stopDragging);
      event.preventDefault();
    });

    window.addEventListener('resize', () => {
      applyPanelPosition(panel, {
        left: parseInt(panel.style.left, 10) || panel.getBoundingClientRect().left,
        top: parseInt(panel.style.top, 10) || panel.getBoundingClientRect().top
      });
    });
  }

  function createIconButton(label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `
      width: 26px !important;
      height: 26px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
      background: white !important;
      color: #33543a !important;
      border: 1px solid #cddfce !important;
      border-radius: 6px !important;
      cursor: pointer !important;
      font-size: 14px !important;
      line-height: 1 !important;
    `;
    return button;
  }

  function getEyeIconSvg(isVisible) {
    if (isVisible) {
      return `
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M2.1 3.5 20.5 21.9l1.4-1.4-3-3a11.8 11.8 0 0 0 3-4.5C20.3 10.1 16.5 7 12 7c-1.5 0-2.9.3-4.2.8L3.5 2.1 2.1 3.5Zm9.9 6.3a2.5 2.5 0 0 1 2.2 2.2l-2.9-2.9c.2-.1.5-.1.7-.1Zm-6 2.2a11.1 11.1 0 0 1 3-2.2l1.7 1.7a2.99 2.99 0 0 0 4.1 4.1l1.9 1.9c-1.4.6-3 .9-4.7.9-3.6 0-6.8-2.1-8-5.4Z"/>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 5c5.2 0 9.4 3.6 10.8 7-1.4 3.4-5.6 7-10.8 7S2.6 15.4 1.2 12C2.6 8.6 6.8 5 12 5Zm0 2C8.2 7 4.9 9.4 3.4 12 4.9 14.6 8.2 17 12 17s7.1-2.4 8.6-5C19.1 9.4 15.8 7 12 7Zm0 2.5A2.5 2.5 0 1 1 12 14a2.5 2.5 0 0 1 0-5Z"/>
      </svg>
    `;
  }

  function getMinimizeIconSvg(isMinimized) {
    if (isMinimized) {
      return `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M11 5h2v14h-2zM5 11h14v2H5z"/>
        </svg>
      `;
    }

    return `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M5 11h14v2H5z"/>
      </svg>
    `;
  }

  function getCloseIconSvg() {
    return `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z"/>
      </svg>
    `;
  }

  function createReopenButton() {
    let reopenButton = document.getElementById('fedexPsdReopenButton');
    if (reopenButton || !document.body) {
      return reopenButton;
    }

    reopenButton = document.createElement('button');
    reopenButton.type = 'button';
    reopenButton.id = 'fedexPsdReopenButton';
    reopenButton.textContent = 'FedEx PSDU';
    reopenButton.title = 'Reabrir painel FedEx PSDU';
    reopenButton.style.cssText = `
      position: fixed !important;
      right: 12px !important;
      bottom: 12px !important;
      z-index: 9999999 !important;
      display: none !important;
      padding: 10px 14px !important;
      background: #1e7e34 !important;
      color: white !important;
      border: 0 !important;
      border-radius: 999px !important;
      box-shadow: 0 6px 18px rgba(0,0,0,0.18) !important;
      cursor: pointer !important;
      font-family: Arial, sans-serif !important;
      font-size: 12px !important;
      font-weight: bold !important;
    `;
    document.body.appendChild(reopenButton);
    return reopenButton;
  }

  function setReopenButtonVisible(visible) {
    const reopenButton = createReopenButton();
    if (!reopenButton) {
      return;
    }

    reopenButton.style.display = visible ? 'block' : 'none';
  }

  function resetUiStateForLogout() {
    console.log('🔄 Resetando estado da UI para logout...');
    uiState.currentUserId = null;
    uiState.printPreference = { ...DEFAULT_PRINT_PREFERENCE };
    uiState.fedexSettings = { ...DEFAULT_FEDEX_SETTINGS };
    uiState.fedexSettingsMode = 'summary';
    uiState.cancelableShipments = [];
    uiState.selectedCancellationTracking = '';
    uiState.backendStatus = {
      source: BACKEND_BASE_URL,
      lastSyncOk: false,
      lastSyncMessage: 'Sessao encerrada'
    };
    window.__READY_TO_FINALIZE__ = [];
    console.log('✅ Estado limpo. currentUserId:', uiState.currentUserId);
  }

  function hidePanelForLogout() {
    console.log('❌ Ocultando painel para logout...');
    resetUiStateForLogout();

    const panel = document.getElementById('fedexPsdPanel');
    if (panel) {
      console.log('🗑️ Removendo painel do DOM');
      panel.remove();
    }

    const reopenButton = document.getElementById('fedexPsdReopenButton');
    if (reopenButton) {
      console.log('🚫 Ocultando botão de reabertura');
      reopenButton.style.display = 'none';
    }

    savePanelUiState({
      ...loadPanelUiState(),
      closed: true,
      minimized: false
    });
    console.log('✅ Painel ocultado. Sessão finalizada.');
  }

  /**
   * NOVO: Monitorar mensagem de logout do content script
   * Limpa todos os dados quando o usuário faz logout
   */
  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }

    if (event.data?.type === 'FEDEX_SESSION_CLEARED') {
      console.log('🚨 Sessão FedEx limpa pelo background script!');
      hidePanelForLogout();
      return true;
    }
  });

  function extractUrl(args) {
    const value = args[0];

    if (!value) {
      return '';
    }

    if (typeof value === 'string') {
      return value;
    }

    if (value.url) {
      return value.url;
    }

    return String(value);
  }

  function parseFedexUrl(url) {
    if (!url) {
      return null;
    }

    try {
      return new URL(url, window.location.origin);
    } catch (error) {
      return null;
    }
  }

  function hasJsonContentType(response) {
    const contentType = response?.headers?.get('content-type') || '';
    return contentType.includes('application/json') || contentType.includes('+json');
  }

  function withAutoPrint(url) {
    const parsedUrl = parseFedexUrl(url);
    if (!parsedUrl) {
      return url;
    }

    parsedUrl.searchParams.set('autoPrint', 'true');
    return parsedUrl.toString();
  }

  function resolveShipmentItems(data) {
    if (Array.isArray(data?.result)) return data.result;
    if (Array.isArray(data?.content)) return data.content;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.data?.content)) return data.data.content;
    if (Array.isArray(data?.payload?.content)) return data.payload.content;
    if (Array.isArray(data?.payload?.items)) return data.payload.items;
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return null;
  }

  function isReadyToFinalizeDraft(item) {
    return item?.shipmentStatus === 'READY_TO_FINALIZE';
  }

  function getDraftCountry(item) {
    return item?.outboundShipmentInformation?.to?.[0]?.address?.countryCode || null;
  }

  function isShipmentListUrl(url) {
    const parsedUrl = parseFedexUrl(url);
    if (!parsedUrl) {
      return false;
    }

    const host = parsedUrl.hostname;
    const pathname = parsedUrl.pathname.replace(/\/+$/, '');
    const isFedexHost =
      host.includes('apps.az.fxei.fedex.com') ||
      host === 'www.fedex.com';

    if (!isFedexHost) {
      return false;
    }

    if (pathname.endsWith('/shipments-overview')) {
      return false;
    }

    return /\/shipments$/.test(pathname);
  }

  function getDraftUserId(draft) {
    return draft?.outboundShipmentInformation?.bookingDetails?.userId || null;
  }

  function getCookieValue(name) {
    const encodedName = `${name}=`;
    const cookies = String(document.cookie || '').split(';');

    for (const rawCookie of cookies) {
      const cookie = rawCookie.trim();
      if (!cookie.startsWith(encodedName)) {
        continue;
      }

      return decodeURIComponent(cookie.slice(encodedName.length)).trim();
    }

    return '';
  }

  function getUserIdFromPageCookies() {
    return (
      getCookieValue('sc_fcl_uuid') ||
      getCookieValue('fcl_uuid') ||
      ''
    );
  }

  function getUserNameFromPageCookies() {
    return getCookieValue('fcl_fname') || '';
  }

  function getCurrentUserId() {
    return uiState.currentUserId || getUserIdFromPageCookies() || getDraftUserId(window.__READY_TO_FINALIZE__?.[0]) || null;
  }

  async function syncUserState(userId) {
    const normalizedUserId = String(userId || '').trim();

    if (!normalizedUserId) {
      console.warn('⚠️ [syncUserState] userId está vazio');
      return null;
    }

    console.log('👤 [syncUserState] Sincronizando usuário:', normalizedUserId);

    uiState.currentUserId = normalizedUserId;
    uiState.printPreference = await fetchPrintPreference(normalizedUserId);
    uiState.fedexSettings = await fetchFedexSettings(normalizedUserId);
    uiState.fedexSettingsMode = uiState.fedexSettings.accounts?.length ? 'summary' : 'create';

    console.log('✅ [syncUserState] Usuário sincronizado:', {
      userId: normalizedUserId,
      accounts: uiState.fedexSettings.accounts?.length || 0,
      mode: uiState.fedexSettingsMode
    });

    const select = document.getElementById('fedexPrintMode');
    if (select) {
      select.value = uiState.printPreference.labelFormat;
    }

    populateFedexSettingsForm();
    await refreshCancelableShipments();
    return normalizedUserId;
  }

  function requestFedexSessionFromExtension() {
    return new Promise((resolve) => {
      const requestId = `fedex-psdu-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const timeoutId = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, 3000);

      const onMessage = (event) => {
        if (event.source !== window) {
          return;
        }

        if (event.data?.type !== 'FEDEX_PSDU_SESSION_RESPONSE' || event.data?.requestId !== requestId) {
          return;
        }

        window.clearTimeout(timeoutId);
        window.removeEventListener('message', onMessage);
        resolve(event.data?.session || null);
      };

      window.addEventListener('message', onMessage);
      window.postMessage({
        type: 'FEDEX_PSDU_GET_SESSION',
        requestId
      }, '*');
    });
  }

  async function ensureCurrentUserId() {
    const existingUserId = getCurrentUserId();

    if (existingUserId) {
      const shouldSyncExistingUser =
        uiState.currentUserId !== existingUserId ||
        (!uiState.fedexSettings.configured && (!uiState.fedexSettings.accounts || !uiState.fedexSettings.accounts.length));

      if (shouldSyncExistingUser) {
        try {
          return await syncUserState(existingUserId);
        } catch (error) {
          console.error('Erro ao sincronizar usuario atual:', error);
        }
      }

      uiState.currentUserId = existingUserId;
      return existingUserId;
    }

    const session = await requestFedexSessionFromExtension();
    const nextUserId = String(session?.userId || '').trim();

    if (!nextUserId) {
      return null;
    }

    uiState.currentUserId = nextUserId;

    try {
      await syncUserState(nextUserId);
    } catch (error) {
      console.error('Erro ao sincronizar sessao FedEx:', error);
    }

    return nextUserId;
  }

  function hasActiveFedexSession() {
    // 🔐 CRÍTICO: Depender APENAS de uiState.currentUserId
    // Os cookies persistem após logout no FedEx e causariam recriação do painel
    return Boolean(uiState.currentUserId);
  }

  function verifySessionAndTogglePanel() {
    if (!hasActiveFedexSession()) {
      hidePanelForLogout();
      return false;
    }

    setReopenButtonVisible(loadPanelUiState().closed);
    if (!document.getElementById('fedexPsdPanel') && document.body) {
      createButton();
    }

    return true;
  }

  function getSelectedFedexAccount() {
    return uiState.fedexSettings.selectedAccount || null;
  }

  function getCurrentPrintPreference() {
    const select = document.getElementById('fedexPrintMode');

    if (!select) {
      return { ...uiState.printPreference };
    }

    return {
      ...uiState.printPreference,
      labelFormat: select.value === 'thermal' ? 'thermal' : 'laser'
    };
  }

  async function fetchPrintPreference(userId) {
    if (!userId) {
      return { ...DEFAULT_PRINT_PREFERENCE };
    }

    try {
      const response = await sendMessageToBackground({
        type: 'FETCH_PRINT_PREFERENCE',
        userId
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao carregar preferencia de impressao');
      }
      return { ...DEFAULT_PRINT_PREFERENCE, ...(response.data || {}) };
    } catch (error) {
      throw error;
    }
  }

  async function fetchFedexSettings(userId) {
    if (!userId) {
      return { ...DEFAULT_FEDEX_SETTINGS };
    }

    try {
      const response = await sendMessageToBackground({
        type: 'FETCH_FEDEX_SETTINGS',
        userId
      });
      if (!response || !response.ok) {
        console.error('❌ Falha ao carregar fedex-settings:', response?.error);
        uiState.backendStatus = {
          source: BACKEND_BASE_URL,
          lastSyncOk: false,
          lastSyncMessage: `Falha ao carregar credenciais`
        };
        throw new Error(response?.error || 'Falha ao carregar configuracoes FedEx');
      }

      console.log('✅ Resposta recebida:', {
        configured: response.data?.configured,
        accountsCount: response.data?.accounts?.length,
        selectedAccountNumber: response.data?.selectedAccountNumber
      });

      uiState.backendStatus = {
        source: BACKEND_BASE_URL,
        lastSyncOk: true,
        lastSyncMessage: response.data?.configured
          ? `Credenciais carregadas: ${response.data.accounts?.length || 0} conta(s)`
          : 'Nenhuma credencial encontrada no backend'
      };

      const result = { ...DEFAULT_FEDEX_SETTINGS, ...(response.data || {}) };
      console.log('📦 [fetchFedexSettings] Retornando:', result);
      return result;
    } catch (error) {
      throw error;
    }
  }

  async function savePrintPreference(userId, preference) {
    try {
      const response = await sendMessageToBackground({
        type: 'SAVE_PRINT_PREFERENCE',
        userId: userId || null,
        preference
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao salvar preferencia de impressao');
      }
      uiState.printPreference = { ...DEFAULT_PRINT_PREFERENCE, ...(response.data || {}) };
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async function saveFedexSettings(userId, settings) {
    try {
      const response = await sendMessageToBackground({
        type: 'SAVE_FEDEX_SETTINGS',
        userId: userId || null,
        settings
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao salvar configuracoes FedEx');
      }
      uiState.fedexSettings = { ...DEFAULT_FEDEX_SETTINGS, ...(response.data || {}) };
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async function selectFedexAccount(userId, accountNumber) {
    try {
      const response = await sendMessageToBackground({
        type: 'SELECT_FEDEX_ACCOUNT',
        userId: userId || null,
        accountNumber
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao selecionar conta FedEx');
      }
      uiState.fedexSettings = { ...DEFAULT_FEDEX_SETTINGS, ...(response.data || {}) };
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async function deleteFedexSettings(userId, accountNumber) {
    userId = userId || await ensureCurrentUserId();

    if (!userId) {
      throw new Error('Usuario FedEx nao identificado na tela atual');
    }

    try {
      const response = await sendMessageToBackground({
        type: 'DELETE_FEDEX_SETTINGS',
        userId,
        accountNumber
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao excluir conta FedEx');
      }
      uiState.fedexSettings = { ...DEFAULT_FEDEX_SETTINGS, ...(response.data || {}) };
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async function loadAccountPreferences(accountNumber) {
    const userId = getCurrentUserId();
    
    if (!userId || !accountNumber) {
      console.warn('📋 [loadAccountPreferences] Dados incompletos:', { userId, accountNumber });
      return;
    }

    try {
      console.log('📋 [loadAccountPreferences] Carregando preferências da conta:', accountNumber);
      
      const response = await sendMessageToBackground({
        type: 'FETCH_ACCOUNT_PREFERENCES',
        userId,
        accountNumber
      });
      
      if (!response || !response.ok) {
        console.warn('⚠️ [loadAccountPreferences] Falha ao carregar:', response?.error);
        return;
      }
      
      console.log('✅ [loadAccountPreferences] Preferências carregadas:', response.data);
      
      // Armazenar preferências no estado da conta específica
      if (uiState.fedexSettings.selectedAccount) {
        uiState.fedexSettings.selectedAccount.preferences = response.data;
      }
      
      return response.data;
    } catch (error) {
      console.error('❌ [loadAccountPreferences] Erro:', error);
      return null;
    }
  }

  function readFedexSettingsForm() {
    return {
      apiKey: document.getElementById('fedexApiKey')?.value?.trim() || '',
      secretKey: document.getElementById('fedexSecretKey')?.value?.trim() || '',
      accountNumber: document.getElementById('fedexAccountNumber')?.value?.trim() || ''
    };
  }

  function resetFedexSettingsForm() {
    const apiKeyInput = document.getElementById('fedexApiKey');
    const secretKeyInput = document.getElementById('fedexSecretKey');
    const accountNumberInput = document.getElementById('fedexAccountNumber');
    const toggleSecretKeyButton = document.getElementById('fedexToggleSecretKey');

    if (apiKeyInput) apiKeyInput.value = '';
    if (secretKeyInput) {
      secretKeyInput.value = '';
      secretKeyInput.type = 'password';
    }
    if (accountNumberInput) accountNumberInput.value = '';
    if (toggleSecretKeyButton) {
      toggleSecretKeyButton.innerHTML = getEyeIconSvg(false);
      toggleSecretKeyButton.title = 'Mostrar Secret Key';
      toggleSecretKeyButton.setAttribute('aria-label', 'Mostrar Secret Key');
    }
  }

  function populateFedexSettingsForm() {
    const apiKeyInput = document.getElementById('fedexApiKey');
    const secretKeyInput = document.getElementById('fedexSecretKey');
    const accountNumberInput = document.getElementById('fedexAccountNumber');
    const status = document.getElementById('fedexSettingsStatus');
    const userHint = document.getElementById('fedexUserHint');
    const accountSelect = document.getElementById('fedexAccountSelect');
    const accountSummary = document.getElementById('fedexAccountSummary');
    const accountActions = document.getElementById('fedexAccountActions');
    const addAccountLink = document.getElementById('fedexAddAccountLink');
    const editAccountLink = document.getElementById('fedexEditAccountLink');
    const deleteAccountLink = document.getElementById('fedexDeleteAccountLink');
    const formSection = document.getElementById('fedexSettingsFormSection');
    const inlineMessage = document.getElementById('fedexInlineMessage');
    const backendHint = document.getElementById('fedexBackendHint');
    const selectedAccount = getSelectedFedexAccount();
    const hasAccounts = Array.isArray(uiState.fedexSettings.accounts) && uiState.fedexSettings.accounts.length > 0;
    const isCompactSummary = hasAccounts && uiState.fedexSettingsMode === 'summary';

    if (apiKeyInput && accountNumberInput && secretKeyInput) {
      if (uiState.fedexSettingsMode === 'edit' && selectedAccount) {
        apiKeyInput.value = selectedAccount.apiKey || '';
        secretKeyInput.value = selectedAccount.secretKey || '';
        accountNumberInput.value = selectedAccount.accountNumber || '';
      } else if (uiState.fedexSettingsMode === 'create') {
        resetFedexSettingsForm();
      } else {
        resetFedexSettingsForm();
      }
    }

    if (status) {
      if (isCompactSummary) {
        status.textContent = 'Credenciais FedEx salvas para este usuario.';
        status.style.color = '#1e7e34';
      } else if (!hasAccounts) {
        status.textContent = 'Cadastre a primeira conta FedEx para este usuario.';
        status.style.color = '#9a6700';
      } else {
        status.textContent = 'Edite ou cadastre outra conta FedEx.';
        status.style.color = '#9a6700';
      }
    }

    if (userHint) {
      const userId = getCurrentUserId(); // continua disponível se precisar
      const userName = getUserNameFromPageCookies();

      const displayName = userName
        ? userName.charAt(0).toUpperCase() + userName.slice(1).toLowerCase()
        : 'Aguardando captura do draft';

      userHint.textContent = `Usuario atual: ${displayName}`;
    }

    if (backendHint) {
      backendHint.textContent = `Backend: ${uiState.backendStatus.source} | ${uiState.backendStatus.lastSyncMessage}`;
      backendHint.style.color = uiState.backendStatus.lastSyncOk ? '#1e7e34' : '#666';
    }

    if (accountSelect) {
      accountSelect.innerHTML = '';

      if (!hasAccounts) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Nenhuma conta cadastrada';
        accountSelect.appendChild(option);
        accountSelect.disabled = true;
      } else {
        uiState.fedexSettings.accounts.forEach((account) => {
          const option = document.createElement('option');
          option.value = account.accountNumber;
          option.textContent = account.accountNumber;
          option.selected = account.accountNumber === uiState.fedexSettings.selectedAccountNumber;
          accountSelect.appendChild(option);
        });
        const newOption = document.createElement('option');
        newOption.value = '__new__';
        newOption.textContent = '+ Nova conta';
        newOption.selected = uiState.fedexSettingsMode === 'create';
        accountSelect.appendChild(newOption);
        accountSelect.disabled = false;
      }

      accountSelect.style.display = isCompactSummary ? 'none' : 'block';
    }

    if (accountSummary) {
      accountSummary.textContent = isCompactSummary
        ? 'Conta pronta para uso.'
        : (selectedAccount ? `Conta ativa: ${selectedAccount.accountNumber}` : 'Nenhuma conta ativa');
      accountSummary.style.display = isCompactSummary ? 'none' : 'block';
    }

    if (accountActions) {
      accountActions.style.display = hasAccounts ? 'flex' : 'none';
    }

    if (addAccountLink) {
      addAccountLink.style.display = 'inline';
    }

    if (editAccountLink) {
      editAccountLink.style.display = selectedAccount ? 'inline' : 'none';
    }

    if (deleteAccountLink) {
      deleteAccountLink.style.display = selectedAccount ? 'inline' : 'none';
    }

    if (formSection) {
      const shouldShowForm = !hasAccounts || uiState.fedexSettingsMode !== 'summary';
      formSection.style.display = shouldShowForm ? 'block' : 'none';
    }

    if (inlineMessage && !inlineMessage.dataset.locked) {
      inlineMessage.textContent = '';
      inlineMessage.style.display = 'none';
    }

    // 📋 Seção de seleção de drafts (Fase 3)
    initializeDraftSelection();
    const draftSection = createDraftSelectionSection();
    if (draftSection) {
      const body = document.querySelector('body');
      if (body) {
        body.appendChild(draftSection);
        console.log('✅ [populateFedexSettingsForm] Seção de drafts injetada');
      }
    }

    // 📦 Seção de tracking/cancelamento (Fase 4)
    const trackingSection = createTrackingListSection();
    if (trackingSection) {
      const body = document.querySelector('body');
      if (body) {
        body.appendChild(trackingSection);
        console.log('✅ [populateFedexSettingsForm] Seção de tracking injetada');
        // Carregar a lista de envios
        loadTrackingList();
      }
    }

    // ⚙️ Seção de utilidades (Fase 5)
    const utilitiesSection = createUtilitiesSection();
    if (utilitiesSection) {
      body.appendChild(utilitiesSection);
      console.log('✅ [populateFedexSettingsForm] Seção de utilidades injetada');
    }

    populateCancellationOptions();
  }

  function showInlineMessage(message, tone = 'success') {
    const inlineMessage = document.getElementById('fedexInlineMessage');
    if (!inlineMessage) {
      return;
    }

    inlineMessage.dataset.locked = 'true';
    inlineMessage.textContent = message;
    inlineMessage.style.display = 'block';
    inlineMessage.style.color = tone === 'error' ? '#b42318' : '#1e7e34';
    inlineMessage.style.background = tone === 'error' ? '#fef3f2' : '#ecfdf3';
    inlineMessage.style.borderColor = tone === 'error' ? '#fecdca' : '#abefc6';
  }

  function clearInlineMessage() {
    const inlineMessage = document.getElementById('fedexInlineMessage');
    if (!inlineMessage) {
      return;
    }

    inlineMessage.dataset.locked = '';
    inlineMessage.textContent = '';
    inlineMessage.style.display = 'none';
  }

  function extractTrackingNumberFromDraftRecord(draft) {
    return (
      draft?.shipmentResponse?.trackingNumber ||
      draft?.shipmentResponse?.shipmentInfo?.masterTrackingNumber ||
      draft?.shipmentResponse?.fullResponse?.output?.transactionShipments?.[0]?.masterTrackingNumber ||
      draft?.trackingNumber ||
      null
    );
  }

  function getDraftRecordUserId(draft) {
    return draft?.fedexUserId || getDraftUserId(draft?.data) || null;
  }

  function populateCancellationOptions() {
    const select = document.getElementById('fedexCancelTrackingSelect');
    const button = document.getElementById('fedexCancelShipmentButton');
    const hint = document.getElementById('fedexCancelHint');
    const selectedAccount = getSelectedFedexAccount();

    if (!select || !button || !hint) {
      return;
    }

    select.innerHTML = '';

    if (!uiState.cancelableShipments.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum tracking disponivel';
      select.appendChild(option);
      select.disabled = true;
      button.disabled = true;
      hint.textContent = 'Os trackings enviados com sucesso aparecerao aqui.';
      return;
    }

    uiState.cancelableShipments.forEach((shipment) => {
      const option = document.createElement('option');
      option.value = shipment.trackingNumber;
      option.textContent = shipment.label;
      option.selected = shipment.trackingNumber === uiState.selectedCancellationTracking;
      select.appendChild(option);
    });

    select.disabled = false;
    button.disabled = !selectedAccount || !uiState.selectedCancellationTracking;
    hint.textContent = selectedAccount
      ? `Conta ativa para cancelamento: ${selectedAccount.accountNumber}`
      : 'Selecione uma conta FedEx antes de cancelar.';
  }

  async function refreshCancelableShipments() {
    try {
      const response = await sendMessageToBackground({
        type: 'FETCH_DRAFTS'
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao carregar drafts processados');
      }

      const drafts = Array.isArray(response.data?.drafts) ? response.data.drafts : [];
      const currentUserId = getCurrentUserId();
      const shipments = drafts
        .filter((draft) => {
          const trackingNumber = extractTrackingNumberFromDraftRecord(draft);
          const draftUserId = getDraftRecordUserId(draft);
          return Boolean(trackingNumber)
            && draft?.status !== 'CANCELLED'
            && (!currentUserId || draftUserId === currentUserId);
        })
        .sort((a, b) => {
          const left = new Date(b?.processedAt || b?.createdAt || 0).getTime();
          const right = new Date(a?.processedAt || a?.createdAt || 0).getTime();
          return left - right;
        })
        .map((draft) => {
          const trackingNumber = extractTrackingNumberFromDraftRecord(draft);
          const draftLabel = draft?.data?.draftNumber || draft?.data?.outboundShipmentInformation?.references?.customerReference || draft?.id;
          return {
            trackingNumber,
            draftId: draft?.id || null,
            label: `${trackingNumber} (${draftLabel || 'draft'})`
          };
        });

      uiState.cancelableShipments = shipments;

      if (!shipments.some((item) => item.trackingNumber === uiState.selectedCancellationTracking)) {
        uiState.selectedCancellationTracking = shipments[0]?.trackingNumber || '';
      }

      populateCancellationOptions();
    } catch (error) {
      console.error('Erro ao carregar trackings cancelaveis:', error);
      uiState.cancelableShipments = [];
      uiState.selectedCancellationTracking = '';
      populateCancellationOptions();
    }
  }

  async function cancelShipment(trackingNumber, accountNumber) {
    if (!trackingNumber) {
      throw new Error('Selecione um tracking para cancelar');
    }

    try {
      const response = await sendMessageToBackground({
        type: 'CANCEL_SHIPMENT',
        userId: null,
        accountNumber,
        trackingNumber
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao cancelar shipment');
      }
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  async function syncPrintPreferenceFromDrafts() {
    const nextUserId = getDraftUserId(window.__READY_TO_FINALIZE__?.[0]);

    if (!nextUserId || nextUserId === uiState.currentUserId) {
      return;
    }

    await syncUserState(nextUserId);
  }

  async function saveDraftToBackend(draft) {
    try {
      const response = await sendMessageToBackground({
        type: 'SAVE_DRAFT',
        draft
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao salvar draft');
      }
      if (!response.data?.draft?.id) {
        throw new Error('Backend nao retornou ID do draft');
      }
      return response.data.draft;
    } catch (error) {
      throw error;
    }
  }

  async function sendDraftToFedex(localDraftId, options = {}) {
    try {
      const response = await sendMessageToBackground({
        type: 'SEND_DRAFT_TO_FEDEX',
        draftId: localDraftId,
        options
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao enviar draft para FedEx');
      }
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // ✅ Inicializar estado de seleção de drafts
  function initializeDraftSelection() {
    try {
      console.log('✅ [initializeDraftSelection] Inicializando seleção de drafts');
      
      if (!uiState.selectedDrafts) {
        uiState.selectedDrafts = [];
      }
      
      console.log('✅ [initializeDraftSelection] Estado inicializado:', {
        selectedCount: uiState.selectedDrafts.length
      });
    } catch (error) {
      console.error('❌ [initializeDraftSelection] Erro:', error);
    }
  }

  // 📝 Criar seção de seleção de drafts
  function createDraftSelectionSection() {
    try {
      console.log('📝 [createDraftSelectionSection] Criando seção de seleção de drafts');
      
      const sectionDiv = document.createElement('div');
      sectionDiv.id = 'fedexDraftSelection';
      sectionDiv.style.cssText = `
        padding: 12px !important;
        background: #f9f9f9 !important;
        border-radius: 6px !important;
        margin: 12px 0 !important;
        border-left: 4px solid #28a745 !important;
      `;
      
      const title = document.createElement('h4');
      title.textContent = '📋 Selecionar Rascunhos para Envio';
      title.style.cssText = `
        margin: 0 0 10px 0 !important;
        font-size: 12px !important;
        font-weight: bold !important;
        color: #28a745 !important;
      `;
      sectionDiv.appendChild(title);
      
      const draftsList = document.createElement('div');
      draftsList.id = 'fedexDraftsList';
      draftsList.style.cssText = `
        max-height: 200px !important;
        overflow-y: auto !important;
        border: 1px solid #ddd !important;
        border-radius: 4px !important;
        padding: 8px !important;
        background: white !important;
      `;
      
      // Preencher com drafts existentes
      if (window.drafts && Array.isArray(window.drafts)) {
        if (window.drafts.length === 0) {
          const noMsg = document.createElement('p');
          noMsg.textContent = '📭 Nenhum rascunho disponível';
          noMsg.style.cssText = 'color: #999 !important; margin: 0 !important; font-size: 11px !important;';
          draftsList.appendChild(noMsg);
        } else {
          window.drafts.forEach((draft, index) => {
            const draftItem = document.createElement('label');
            draftItem.style.cssText = `
              display: flex !important;
              align-items: center !important;
              padding: 6px 4px !important;
              cursor: pointer !important;
              border-radius: 3px !important;
              transition: background 0.2s !important;
            `;
            draftItem.onmouseover = () => { draftItem.style.background = '#f0f0f0 !important'; };
            draftItem.onmouseout = () => { draftItem.style.background = 'transparent !important'; };
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'fedexDraftCheckbox';
            checkbox.dataset.draftId = draft.id || index;
            checkbox.dataset.draftIndex = index;
            checkbox.style.cssText = 'margin-right: 8px !important; cursor: pointer !important;';
            
            checkbox.addEventListener('change', (e) => {
              handleDraftCheckboxChange(e, draft);
            });
            
            const labelText = document.createElement('span');
            labelText.style.cssText = 'font-size: 11px !important; flex: 1 !important;';
            labelText.textContent = `📦 ${draft.name || 'Rascunho ' + (index + 1)}`;
            
            draftItem.appendChild(checkbox);
            draftItem.appendChild(labelText);
            draftsList.appendChild(draftItem);
          });
        }
      } else {
        const noMsg = document.createElement('p');
        noMsg.textContent = '📭 Nenhum rascunho disponível';
        noMsg.style.cssText = 'color: #999 !important; margin: 0 !important; font-size: 11px !important;';
        draftsList.appendChild(noMsg);
      }
      
      sectionDiv.appendChild(draftsList);
      
      // Contador de seleção
      const counterDiv = document.createElement('div');
      counterDiv.id = 'fedexDraftCounter';
      counterDiv.style.cssText = `
        margin-top: 8px !important;
        font-size: 11px !important;
        color: #666 !important;
        text-align: right !important;
      `;
      counterDiv.textContent = '0️⃣ Nenhum selecionado';
      sectionDiv.appendChild(counterDiv);
      
      // Botão de envio
      const sendDiv = document.createElement('div');
      sendDiv.style.cssText = 'margin-top: 10px !important; display: flex !important; gap: 8px !important;';
      
      const sendBtn = document.createElement('button');
      sendBtn.id = 'fedexSendDraftsBtn';
      sendBtn.textContent = '🚀 Enviar Selecionados';
      sendBtn.style.cssText = `
        flex: 1 !important;
        padding: 8px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #28a745 !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      `;
      sendBtn.disabled = true;
      sendBtn.style.opacity = '0.5';
      sendBtn.addEventListener('click', handleSendSelectedDrafts);
      sendBtn.onmouseover = function() {
        if (!this.disabled) this.style.background = '#218838 !important';
      };
      sendBtn.onmouseout = function() {
        if (!this.disabled) this.style.background = '#28a745 !important';
      };
      
      const clearBtn = document.createElement('button');
      clearBtn.id = 'fedexClearDraftsBtn';
      clearBtn.textContent = '🔄 Limpar';
      clearBtn.style.cssText = `
        padding: 8px 12px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #6c757d !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      `;
      clearBtn.addEventListener('click', handleClearDraftSelection);
      clearBtn.onmouseover = function() {
        this.style.background = '#5a6268 !important';
      };
      clearBtn.onmouseout = function() {
        this.style.background = '#6c757d !important';
      };
      
      sendDiv.appendChild(sendBtn);
      sendDiv.appendChild(clearBtn);
      sectionDiv.appendChild(sendDiv);
      
      console.log('✅ [createDraftSelectionSection] Seção criada com sucesso');
      
      return sectionDiv;
    } catch (error) {
      console.error('❌ [createDraftSelectionSection] Erro ao criar seção:', error);
      return null;
    }
  }

  // ☑️ Handler para mudança de checkbox
  function handleDraftCheckboxChange(event, draft) {
    try {
      const checkbox = event.target;
      const draftId = checkbox.dataset.draftId;
      const isChecked = checkbox.checked;
      
      console.log('☑️ [handleDraftCheckboxChange] Draft ' + (isChecked ? 'selecionado' : 'deseleccionado') + ':', draftId);
      
      if (isChecked) {
        if (!uiState.selectedDrafts.includes(draftId)) {
          uiState.selectedDrafts.push(draftId);
        }
      } else {
        uiState.selectedDrafts = uiState.selectedDrafts.filter(id => id !== draftId);
      }
      
      updateDraftSelectionUI();
    } catch (error) {
      console.error('❌ [handleDraftCheckboxChange] Erro:', error);
    }
  }

  // 🔄 Atualizar UI de seleção de drafts
  function updateDraftSelectionUI() {
    try {
      const count = uiState.selectedDrafts?.length || 0;
      const counter = document.getElementById('fedexDraftCounter');
      
      if (counter) {
        if (count === 0) {
          counter.textContent = '0️⃣ Nenhum selecionado';
        } else if (count === 1) {
          counter.textContent = '1️⃣ 1 rascunho selecionado';
        } else {
          counter.textContent = `📦 ${count} rascunhos selecionados`;
        }
      }
      
      const sendBtn = document.getElementById('fedexSendDraftsBtn');
      if (sendBtn) {
        sendBtn.disabled = count === 0;
        sendBtn.style.opacity = count === 0 ? '0.5' : '1';
      }
      
      console.log('🔄 [updateDraftSelectionUI] UI atualizada:', { count });
    } catch (error) {
      console.error('❌ [updateDraftSelectionUI] Erro:', error);
    }
  }

  // 🔄 Limpar seleção de drafts
  function handleClearDraftSelection() {
    try {
      console.log('🔄 [handleClearDraftSelection] Limpando seleção');
      
      uiState.selectedDrafts = [];
      
      // Desmarcar todos os checkboxes
      const checkboxes = document.querySelectorAll('.fedexDraftCheckbox');
      checkboxes.forEach(checkbox => {
        checkbox.checked = false;
      });
      
      updateDraftSelectionUI();
      showInlineMessage('Seleção limpa', 'info');
      
      console.log('✅ [handleClearDraftSelection] Seleção limpa');
    } catch (error) {
      console.error('❌ [handleClearDraftSelection] Erro:', error);
    }
  }

  // ✔️ Validar seleção de drafts antes de enviar
  function validateDraftSelection() {
    try {
      console.log('✔️ [validateDraftSelection] Validando seleção');
      
      const errors = [];
      
      if (!uiState.selectedDrafts || uiState.selectedDrafts.length === 0) {
        errors.push('📭 Nenhum rascunho selecionado');
      }
      
      if (!uiState.currentUserId) {
        errors.push('👤 Usuário não identificado');
      }
      
      if (!uiState.fedexSettings?.selectedAccountNumber) {
        errors.push('🏢 Nenhuma conta FedEx selecionada');
      }
      
      if (!window.drafts || window.drafts.length === 0) {
        errors.push('📋 Nenhum rascunho disponível no sistema');
      }
      
      const isValid = errors.length === 0;
      
      console.log('✔️ [validateDraftSelection] Resultado:', {
        isValid,
        errorsCount: errors.length,
        selectedCount: uiState.selectedDrafts?.length || 0
      });
      
      return { isValid, errors };
    } catch (error) {
      console.error('❌ [validateDraftSelection] Erro:', error);
      return { isValid: false, errors: ['Erro ao validar seleção'] };
    }
  }

  // 📦 Converter drafts selecionados para PSDU
  function parseDraftsForPsdu(draftIds) {
    try {
      console.log('📦 [parseDraftsForPsdu] Convertendo drafts para PSDU:', draftIds);
      
      if (!window.drafts || !Array.isArray(window.drafts)) {
        console.error('❌ [parseDraftsForPsdu] Drafts não disponíveis');
        return [];
      }
      
      const psduData = draftIds.map((draftId, index) => {
        const draft = window.drafts.find(d => d.id === draftId || String(window.drafts.indexOf(d)) === String(draftId));
        
        if (!draft) {
          console.warn('⚠️ [parseDraftsForPsdu] Draft não encontrado:', draftId);
          return null;
        }
        
        return {
          index: index,
          draftId: draft.id || draftId,
          shipmentInfo: draft.shipmentInfo || {},
          recipient: draft.recipient || {},
          packages: Array.isArray(draft.packages) ? draft.packages : [],
          notes: draft.notes || '',
          selectedService: draft.selectedService || 'STANDARD_OVERNIGHT'
        };
      }).filter(item => item !== null);
      
      console.log('✅ [parseDraftsForPsdu] Conversão completa:', {
        inputCount: draftIds.length,
        outputCount: psduData.length
      });
      
      return psduData;
    } catch (error) {
      console.error('❌ [parseDraftsForPsdu] Erro ao converter drafts:', error);
      return [];
    }
  }

  // 🚀 Handler para enviar drafts selecionados
  async function handleSendSelectedDrafts() {
    try {
      console.log('🚀 [handleSendSelectedDrafts] Iniciando envio de drafts selecionados');
      
      // Validar seleção
      const validation = validateDraftSelection();
      if (!validation.isValid) {
        console.warn('⚠️ [handleSendSelectedDrafts] Validação falhou:', validation.errors);
        validation.errors.forEach(error => {
          showInlineMessage(error, 'warning');
        });
        return;
      }
      
      // Converter para PSDU
      const psduPayload = parseDraftsForPsdu(uiState.selectedDrafts);
      if (psduPayload.length === 0) {
        showInlineMessage('❌ Erro ao processar rascunhos', 'error');
        return;
      }
      
      console.log('📤 [handleSendSelectedDrafts] Payload preparado:', {
        count: psduPayload.length,
        userId: uiState.currentUserId,
        accountNumber: uiState.fedexSettings?.selectedAccountNumber
      });
      
      // Desabilitar botão durante envio
      const sendBtn = document.getElementById('fedexSendDraftsBtn');
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';
        sendBtn.textContent = '⏳ Enviando...';
      }
      
      showInlineMessage('⏳ Enviando rascunhos para FedEx...', 'info');
      
      // Enviar para backend
      const results = await Promise.all(
        psduPayload.map(psdu => {
          return new Promise(async (resolve) => {
            try {
              const response = await sendMessageToBackground({
                type: 'SEND_DRAFT_TO_FEDEX',
                userId: uiState.currentUserId,
                accountNumber: uiState.fedexSettings?.selectedAccountNumber,
                psduData: psdu
              });
              
              if (response && response.ok) {
                console.log('✅ [handleSendSelectedDrafts] Draft enviado:', {
                  index: psdu.index,
                  trackingNumber: response.data?.trackingNumber
                });
                resolve({ success: true, data: response.data });
              } else {
                console.error('❌ [handleSendSelectedDrafts] Erro no envio:', response?.error);
                resolve({ success: false, error: response?.error });
              }
            } catch (error) {
              console.error('❌ [handleSendSelectedDrafts] Erro:', error.message);
              resolve({ success: false, error: error.message });
            }
          });
        })
      );
      
      // Processar resultados
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.filter(r => !r.success).length;
      
      console.log('📊 [handleSendSelectedDrafts] Resumo do envio:', {
        total: results.length,
        sucesso: successCount,
        erro: failureCount
      });
      
      // Limpar seleção
      handleClearDraftSelection();
      
      // Exibir resultados
      if (successCount > 0 && failureCount === 0) {
        showInlineMessage(`✅ Sucesso! ${successCount} rascunho(s) enviado(s) para FedEx`, 'success');
        displayPrintedLabels(results.filter(r => r.success).map(r => r.data));
      } else if (successCount > 0 && failureCount > 0) {
        showInlineMessage(`⚠️ ${successCount} enviado(s), ${failureCount} erro(s)`, 'warning');
        displayPrintedLabels(results.filter(r => r.success).map(r => r.data));
      } else {
        showInlineMessage(`❌ Erro ao enviar rascunhos: ${failureCount} falha(s)`, 'error');
      }
    } catch (error) {
      console.error('❌ [handleSendSelectedDrafts] Erro geral:', error);
      showInlineMessage('❌ Erro ao enviar rascunhos: ' + error.message, 'error');
    } finally {
      const sendBtn = document.getElementById('fedexSendDraftsBtn');
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.style.opacity = '0.5';
        sendBtn.textContent = '🚀 Enviar Selecionados';
      }
    }
  }

  // 🏷️ Exibir labels impressos
  function displayPrintedLabels(shipmentResults) {
    try {
      console.log('🏷️ [displayPrintedLabels] Exibindo labels para', shipmentResults.length, 'envios');
      
      // Procurar seção existente
      let labelsSection = document.getElementById('fedexPrintedLabels');
      if (labelsSection) {
        labelsSection.remove();
      }
      
      const container = document.createElement('div');
      container.id = 'fedexPrintedLabels';
      container.style.cssText = `
        padding: 12px !important;
        background: #d4edda !important;
        border-radius: 6px !important;
        margin: 12px 0 !important;
        border-left: 4px solid #28a745 !important;
      `;
      
      const title = document.createElement('h4');
      title.textContent = '✅ Labels Gerados com Sucesso';
      title.style.cssText = `
        margin: 0 0 10px 0 !important;
        font-size: 12px !important;
        font-weight: bold !important;
        color: #155724 !important;
      `;
      container.appendChild(title);
      
      const labelsList = document.createElement('div');
      labelsList.style.cssText = 'font-size: 11px !important; color: #155724 !important;';
      
      shipmentResults.forEach((result, index) => {
        const labelItem = document.createElement('div');
        labelItem.style.cssText = 'padding: 4px 0 !important; border-bottom: 1px solid #c3e6cb !important;';
        
        const trackingNum = result?.trackingNumber || result?.id || `Envio ${index + 1}`;
        const status = result?.status || 'Pendente';
        
        labelItem.innerHTML = `
          📦 <strong>${trackingNum}</strong><br/>
          Status: ${status}<br/>
          Label: <a href="#" style="color: #007bff !important; text-decoration: underline !important;">Imprimir</a>
        `;
        
        labelsList.appendChild(labelItem);
      });
      
      container.appendChild(labelsList);
      
      // Botão para imprimir todos
      const printAllBtn = document.createElement('button');
      printAllBtn.textContent = '🖨️ Imprimir Todos';
      printAllBtn.style.cssText = `
        margin-top: 10px !important;
        padding: 8px 12px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #007bff !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        width: 100% !important;
      `;
      printAllBtn.addEventListener('click', () => {
        console.log('🖨️ Iniciando impressão de todos os labels');
        showInlineMessage('🖨️ Enviando para impressora...', 'info');
      });
      
      container.appendChild(printAllBtn);
      
      const body = document.body;
      if (body) {
        body.appendChild(container);
      }
      
      console.log('✅ [displayPrintedLabels] Labels exibidos com sucesso');
    } catch (error) {
      console.error('❌ [displayPrintedLabels] Erro:', error);
    }
  }

  // 📦 Carregar lista de shipments/envios canceláveis
  function loadTrackingList() {
    try {
      console.log('📦 [loadTrackingList] Carregando lista de envios');
      
      if (!uiState.currentUserId) {
        console.warn('⚠️ [loadTrackingList] UserId não disponível');
        return;
      }
      
      sendMessageToBackground({
        type: 'FETCH_CANCELABLE_SHIPMENTS',
        userId: uiState.currentUserId,
        accountNumber: uiState.fedexSettings?.selectedAccountNumber
      }).then(response => {
        if (response && response.ok) {
          console.log('✅ [loadTrackingList] Shipments carregados:', {
            count: response.data?.shipments?.length || 0
          });
          
          uiState.cancelableShipments = response.data?.shipments || [];
          displayTrackingList(uiState.cancelableShipments);
        } else {
          console.error('❌ [loadTrackingList] Erro ao carregar:', response?.error);
          uiState.cancelableShipments = [];
          displayTrackingList([]);
          showInlineMessage('⚠️ Nenhum envio disponível para cancelamento', 'warning');
        }
      }).catch(error => {
        console.error('❌ [loadTrackingList] Erro na requisição:', error);
        uiState.cancelableShipments = [];
        displayTrackingList([]);
      });
    } catch (error) {
      console.error('❌ [loadTrackingList] Erro geral:', error);
    }
  }

  // 📋 Criar seção de lista de envios
  function createTrackingListSection() {
    try {
      console.log('📋 [createTrackingListSection] Criando seção de envios');
      
      const sectionDiv = document.createElement('div');
      sectionDiv.id = 'fedexTrackingSection';
      sectionDiv.style.cssText = `
        padding: 12px !important;
        background: #f9f9f9 !important;
        border-radius: 6px !important;
        margin: 12px 0 !important;
        border-left: 4px solid #ff9800 !important;
      `;
      
      const title = document.createElement('h4');
      title.textContent = '📦 Envios Recentes';
      title.style.cssText = `
        margin: 0 0 10px 0 !important;
        font-size: 12px !important;
        font-weight: bold !important;
        color: #ff9800 !important;
      `;
      sectionDiv.appendChild(title);
      
      const trackingsList = document.createElement('div');
      trackingsList.id = 'fedexTrackingsList';
      trackingsList.style.cssText = `
        max-height: 250px !important;
        overflow-y: auto !important;
        border: 1px solid #ddd !important;
        border-radius: 4px !important;
        padding: 8px !important;
        background: white !important;
      `;
      
      sectionDiv.appendChild(trackingsList);
      
      console.log('✅ [createTrackingListSection] Seção criada');
      
      return sectionDiv;
    } catch (error) {
      console.error('❌ [createTrackingListSection] Erro:', error);
      return null;
    }
  }

  // 📋 Exibir lista de envios
  function displayTrackingList(shipments) {
    try {
      console.log('📋 [displayTrackingList] Exibindo', shipments?.length || 0, 'envios');
      
      const trackingsList = document.getElementById('fedexTrackingsList');
      if (!trackingsList) {
        console.warn('⚠️ [displayTrackingList] Container não encontrado');
        return;
      }
      
      // Limpar lista anterior
      trackingsList.innerHTML = '';
      
      if (!shipments || shipments.length === 0) {
        const noMsg = document.createElement('p');
        noMsg.textContent = '📭 Nenhum envio para cancelar no momento';
        noMsg.style.cssText = 'color: #999 !important; margin: 0 !important; font-size: 11px !important; text-align: center !important;';
        trackingsList.appendChild(noMsg);
        return;
      }
      
      shipments.forEach((shipment, index) => {
        const shipmentDiv = document.createElement('div');
        shipmentDiv.style.cssText = `
          padding: 8px !important;
          margin-bottom: 8px !important;
          border: 1px solid #eee !important;
          border-radius: 4px !important;
          background: #fafafa !important;
        `;
        
        // Info do envio
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'margin-bottom: 6px !important;';
        
        const trackingNum = shipment.trackingNumber || shipment.id;
        const status = shipment.status || 'Pendente';
        const createdAt = shipment.createdAt ? new Date(shipment.createdAt).toLocaleDateString('pt-BR') : 'N/A';
        
        infoDiv.innerHTML = `
          <div style="font-weight: bold !important; font-size: 11px !important; color: #333 !important;">
            🏷️ ${trackingNum}
          </div>
          <div style="font-size: 10px !important; color: #666 !important;">
            Status: <span style="color: ${getStatusColor(status)} !important;">${status}</span> | Data: ${createdAt}
          </div>
        `;
        shipmentDiv.appendChild(infoDiv);
        
        // Destino
        if (shipment.recipient) {
          const recipientDiv = document.createElement('div');
          recipientDiv.style.cssText = 'font-size: 10px !important; color: #666 !important; margin-bottom: 6px !important;';
          recipientDiv.textContent = `📍 ${shipment.recipient.name || 'N/A'} - ${shipment.recipient.city || ''}`;
          shipmentDiv.appendChild(recipientDiv);
        }
        
        // Botões de ação
        const actionDiv = document.createElement('div');
        actionDiv.style.cssText = 'display: flex !important; gap: 6px !important;';
        
        const detailsBtn = document.createElement('button');
        detailsBtn.textContent = '👁️ Detalhes';
        detailsBtn.style.cssText = `
          flex: 1 !important;
          padding: 4px 6px !important;
          font-size: 9px !important;
          background: #17a2b8 !important;
          color: white !important;
          border: none !important;
          border-radius: 3px !important;
          cursor: pointer !important;
        `;
        detailsBtn.addEventListener('click', () => {
          console.log('👁️ Exibindo detalhes do shipment:', trackingNum);
          showInlineMessage('📋 Detalhes: ' + trackingNum, 'info');
        });
        
        const cancelBtn = document.createElement('button');
        const isCancelable = status.toLowerCase() !== 'entregue' && status.toLowerCase() !== 'cancelado';
        cancelBtn.textContent = '❌ Cancelar';
        cancelBtn.style.cssText = `
          flex: 1 !important;
          padding: 4px 6px !important;
          font-size: 9px !important;
          background: ${isCancelable ? '#dc3545' : '#ccc'} !important;
          color: white !important;
          border: none !important;
          border-radius: 3px !important;
          cursor: ${isCancelable ? 'pointer' : 'not-allowed'} !important;
          opacity: ${isCancelable ? '1' : '0.6'} !important;
        `;
        cancelBtn.disabled = !isCancelable;
        cancelBtn.addEventListener('click', () => {
          if (isCancelable) {
            handleCancelShipment(trackingNum, shipment);
          }
        });
        
        actionDiv.appendChild(detailsBtn);
        actionDiv.appendChild(cancelBtn);
        shipmentDiv.appendChild(actionDiv);
        
        trackingsList.appendChild(shipmentDiv);
      });
      
      console.log('✅ [displayTrackingList] Lista exibida com sucesso');
    } catch (error) {
      console.error('❌ [displayTrackingList] Erro ao exibir lista:', error);
    }
  }

  // 🎨 Obter cor do status
  function getStatusColor(status) {
    const colors = {
      'pendente': '#ffc107',
      'em trânsito': '#17a2b8',
      'entregue': '#28a745',
      'cancelado': '#6c757d',
      'erro': '#dc3545'
    };
    return colors[status?.toLowerCase()] || '#999';
  }

  // ❌ Handler para cancelar shipment
  async function handleCancelShipment(trackingNumber, shipment) {
    try {
      console.log('❌ [handleCancelShipment] Iniciando cancelamento:', trackingNumber);
      
      if (!uiState.currentUserId) {
        showInlineMessage('👤 Usuário não identificado', 'error');
        return;
      }
      
      if (!uiState.fedexSettings?.selectedAccountNumber) {
        showInlineMessage('🏢 Nenhuma conta selecionada', 'error');
        return;
      }
      
      // Confirmação
      const confirmed = confirm(
        `⚠️ Tem certeza que deseja cancelar o envio ${trackingNumber}?\n\n` +
        `Esta ação não pode ser desfeita.`
      );
      
      if (!confirmed) {
        console.log('⚠️ [handleCancelShipment] Cancelamento abortado pelo usuário');
        return;
      }
      
      showInlineMessage('⏳ Cancelando envio...', 'info');
      
      const response = await sendMessageToBackground({
        type: 'CANCEL_SHIPMENT',
        userId: uiState.currentUserId,
        trackingNumber: trackingNumber,
        accountNumber: uiState.fedexSettings?.selectedAccountNumber
      });
      
      if (response && response.ok) {
        console.log('✅ [handleCancelShipment] Envio cancelado com sucesso');
        showInlineMessage(`✅ Envio ${trackingNumber} cancelado com sucesso!`, 'success');
        
        // Recarregar lista
        loadTrackingList();
      } else {
        console.error('❌ [handleCancelShipment] Erro ao cancelar:', response?.error);
        showInlineMessage('❌ Erro ao cancelar: ' + (response?.error || 'desconhecido'), 'error');
      }
    } catch (error) {
      console.error('❌ [handleCancelShipment] Erro geral:', error);
      showInlineMessage('❌ Erro ao cancelar envio: ' + error.message, 'error');
    }
  }

  // 🔄 Atualizar lista de tracking
  function updateTrackingList() {
    try {
      console.log('🔄 [updateTrackingList] Atualizando lista de tracking');
      loadTrackingList();
    } catch (error) {
      console.error('❌ [updateTrackingList] Erro:', error);
    }
  }

  // 🔐 Logout - limpar dados temporários
  function handleLogout() {
    try {
      console.log('🔐 [handleLogout] Iniciando logout');
      
      // Confirmação
      const confirmed = confirm(
        `⚠️ Tem certeza que deseja sair?\n\n` +
        `Você será desconectado e a sessão será encerrada.`
      );
      
      if (!confirmed) {
        console.log('⚠️ [handleLogout] Logout cancelado pelo usuário');
        return;
      }
      
      // Limpar dados
      clearAllSessionData();
      
      // Fechar painel
      closeExtensionUI();
      
      showInlineMessage('✅ Você foi desconectado. Até logo!', 'success');
      
      console.log('✅ [handleLogout] Logout concluído');
    } catch (error) {
      console.error('❌ [handleLogout] Erro:', error);
      showInlineMessage('❌ Erro ao fazer logout', 'error');
    }
  }

  // 🗑️ Limpar todos os dados temporários
  function clearAllSessionData() {
    try {
      console.log('🗑️ [clearAllSessionData] Limpando dados da sessão');
      
      // Limpar uiState
      uiState.currentUserId = null;
      uiState.printPreference = { ...DEFAULT_PRINT_PREFERENCE };
      uiState.fedexSettings = { ...DEFAULT_FEDEX_SETTINGS };
      uiState.fedexSettingsMode = 'summary';
      uiState.cancelableShipments = [];
      uiState.selectedCancellationTracking = '';
      uiState.selectedDrafts = [];
      
      if (uiState.backendStatus) {
        uiState.backendStatus.lastSyncOk = false;
        uiState.backendStatus.lastSyncMessage = 'Sessão encerrada';
      }
      
      // Limpar localStorage
      try {
        localStorage.removeItem(PANEL_POSITION_STORAGE_KEY);
        localStorage.removeItem(PANEL_UI_STATE_STORAGE_KEY);
      } catch (e) {
        console.warn('⚠️ [clearAllSessionData] Erro ao limpar localStorage:', e);
      }
      
      // Limpar DOM
      const panel = document.getElementById('fedexPsdPanel');
      if (panel) {
        panel.remove();
      }
      
      console.log('✅ [clearAllSessionData] Dados da sessão limpos');
    } catch (error) {
      console.error('❌ [clearAllSessionData] Erro ao limpar:', error);
    }
  }

  // ❌ Fechar interface da extensão
  function closeExtensionUI() {
    try {
      console.log('❌ [closeExtensionUI] Fechando interface da extensão');
      
      // Remover painel principal
      const panel = document.getElementById('fedexPsdPanel');
      if (panel) {
        panel.style.display = 'none';
        setTimeout(() => {
          try {
            panel.remove();
          } catch (e) {
            console.warn('⚠️ [closeExtensionUI] Erro ao remover painel:', e);
          }
        }, 500);
      }
      
      // Remover botão de toggle
      const toggleBtn = document.getElementById('fedexToggleBtn');
      if (toggleBtn) {
        toggleBtn.remove();
      }
      
      // Remover outros elementos
      const elements = [
        'fedexStatusIndicators',
        'fedexDraftSelection',
        'fedexTrackingSection',
        'fedexPrintedLabels',
        'fedexFormErrors'
      ];
      
      elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.remove();
      });
      
      console.log('✅ [closeExtensionUI] Interface fechada');
    } catch (error) {
      console.error('❌ [closeExtensionUI] Erro:', error);
    }
  }

  // ⚙️ Criar seção de utilidades/configurações
  function createUtilitiesSection() {
    try {
      console.log('⚙️ [createUtilitiesSection] Criando seção de utilidades');
      
      const sectionDiv = document.createElement('div');
      sectionDiv.id = 'fedexUtilities';
      sectionDiv.style.cssText = `
        padding: 12px !important;
        background: #f9f9f9 !important;
        border-radius: 6px !important;
        margin: 12px 0 !important;
        border-left: 4px solid #6c757d !important;
      `;
      
      const title = document.createElement('h4');
      title.textContent = '⚙️ Utilitários';
      title.style.cssText = `
        margin: 0 0 10px 0 !important;
        font-size: 12px !important;
        font-weight: bold !important;
        color: #6c757d !important;
      `;
      sectionDiv.appendChild(title);
      
      const buttonsDiv = document.createElement('div');
      buttonsDiv.style.cssText = 'display: flex !important; gap: 8px !important; flex-wrap: wrap !important;';
      
      // Botão: Refresh
      const refreshBtn = document.createElement('button');
      refreshBtn.textContent = '🔄 Atualizar';
      refreshBtn.style.cssText = `
        flex: 1 !important;
        min-width: 100px !important;
        padding: 8px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #17a2b8 !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      `;
      refreshBtn.addEventListener('click', () => {
        console.log('🔄 Atualizando dados...');
        syncUserState(uiState.currentUserId);
        updateTrackingList();
        showInlineMessage('✅ Dados atualizados', 'success');
      });
      refreshBtn.onmouseover = function() { this.style.background = '#138496 !important'; };
      refreshBtn.onmouseout = function() { this.style.background = '#17a2b8 !important'; };
      
      // Botão: Limpar Cache
      const clearCacheBtn = document.createElement('button');
      clearCacheBtn.textContent = '🧹 Limpar Cache';
      clearCacheBtn.style.cssText = `
        flex: 1 !important;
        min-width: 100px !important;
        padding: 8px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #ffc107 !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      `;
      clearCacheBtn.addEventListener('click', () => {
        try {
          localStorage.clear();
          sessionStorage.clear();
          showInlineMessage('✅ Cache limpo com sucesso', 'success');
          console.log('✅ Cache limpo');
        } catch (e) {
          showInlineMessage('⚠️ Erro ao limpar cache', 'warning');
        }
      });
      clearCacheBtn.onmouseover = function() { this.style.background = '#e0a800 !important'; };
      clearCacheBtn.onmouseout = function() { this.style.background = '#ffc107 !important'; };
      
      // Botão: Logout
      const logoutBtn = document.createElement('button');
      logoutBtn.textContent = '🔐 Logout';
      logoutBtn.style.cssText = `
        flex: 1 !important;
        min-width: 100px !important;
        padding: 8px !important;
        font-size: 11px !important;
        font-weight: bold !important;
        background: #dc3545 !important;
        color: white !important;
        border: none !important;
        border-radius: 4px !important;
        cursor: pointer !important;
      `;
      logoutBtn.addEventListener('click', handleLogout);
      logoutBtn.onmouseover = function() { this.style.background = '#c82333 !important'; };
      logoutBtn.onmouseout = function() { this.style.background = '#dc3545 !important'; };
      
      buttonsDiv.appendChild(refreshBtn);
      buttonsDiv.appendChild(clearCacheBtn);
      buttonsDiv.appendChild(logoutBtn);
      sectionDiv.appendChild(buttonsDiv);
      
      // Info box
      const infoDiv = document.createElement('div');
      infoDiv.style.cssText = `
        margin-top: 10px !important;
        padding: 8px !important;
        background: #fff3cd !important;
        border-radius: 4px !important;
        border-left: 3px solid #ffc107 !important;
        font-size: 10px !important;
        color: #856404 !important;
      `;
      infoDiv.innerHTML = `
        <strong>ℹ️ Versão:</strong> 1.0.0<br/>
        <strong>Backend:</strong> ${BACKEND_BASE_URL.includes('localhost') ? '🏠 Localhost' : '☁️ Render'}<br/>
        <strong>Status:</strong> ${uiState.backendStatus?.lastSyncMessage || 'Inicializando'}
      `;
      sectionDiv.appendChild(infoDiv);
      
      console.log('✅ [createUtilitiesSection] Seção criada');
      
      return sectionDiv;
    } catch (error) {
      console.error('❌ [createUtilitiesSection] Erro:', error);
      return null;
    }
  }

  function openDocumentUrl(url) {
    if (!url) {
      return;
    }

    const popupFeatures = [
      'popup=yes',
      'width=1100',
      'height=800',
      'left=120',
      'top=80',
      'noopener',
      'noreferrer'
    ].join(',');

    window.open(withAutoPrint(url), '_blank', popupFeatures);
  }

  function base64ToBlob(base64Content, mimeType = 'application/pdf') {
    const binaryString = window.atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);

    for (let index = 0; index < binaryString.length; index++) {
      bytes[index] = binaryString.charCodeAt(index);
    }

    return new Blob([bytes], { type: mimeType });
  }

  function openEncodedDocument(base64Content, fileName) {
    if (!base64Content) {
      return;
    }

    const blob = base64ToBlob(base64Content, 'application/pdf');
    const objectUrl = window.URL.createObjectURL(blob);
    const popup = window.open(objectUrl, '_blank', 'popup=yes,width=1100,height=800,left=120,top=80,noopener,noreferrer');

    if (!popup) {
      const link = document.createElement('a');
      link.href = objectUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = fileName || 'documento-fedex.pdf';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }

    window.setTimeout(() => {
      window.URL.revokeObjectURL(objectUrl);
    }, 60000);
  }

  async function fetchEncodedDraftDocuments(draftId) {
    try {
      const response = await sendMessageToBackground({
        type: 'FETCH_ENCODED_DOCUMENTS',
        draftId
      });
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Falha ao carregar documentos codificados');
      }
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  function handleShipmentPrinting(result, printPreference) {
    return fetchEncodedDraftDocuments(result?.draftId).then((payload) => {
      const names = Array.isArray(payload?.encodedDocumentNames) ? payload.encodedDocumentNames : [];
      const documents = Array.isArray(payload?.encodedDocuments) ? payload.encodedDocuments : [];

      if (!documents.length) {
        throw new Error('Nenhum documento codificado retornado para impressao');
      }

      if (printPreference?.labelFormat === 'thermal') {
        openEncodedDocument(documents[0], names[0]);

        for (let index = 1; index < documents.length; index++) {
          openEncodedDocument(documents[index], names[index]);
        }

        return;
      }

      documents.forEach((documentBase64, index) => {
        openEncodedDocument(documentBase64, names[index]);
      });
    });
  }

  async function processDraftEndToEnd(draft, index, total, options = {}) {
    console.log(`%c[Fluxo] Draft ${index + 1}/${total}: salvando no backend...`, 'color: #0066cc;');
    const savedDraft = await saveDraftToBackend(draft);

    console.log(`%c[Fluxo] Draft ${index + 1}/${total}: criando shipment na FedEx...`, 'color: #0066cc;');
    const shipmentResult = await sendDraftToFedex(savedDraft.id, options);

    if (options?.printPreference?.autoOpenDocuments !== false) {
      await handleShipmentPrinting(shipmentResult, options?.printPreference);
    }

    return {
      localDraftId: savedDraft.id,
      fedexDraftId: draft.id,
      trackingNumber: shipmentResult?.shipmentResponse?.trackingNumber || shipmentResult?.shipmentResponse?.shipmentInfo?.masterTrackingNumber || null,
      shipmentLinks: shipmentResult?.shipmentLinks || null,
      printPreference: shipmentResult?.printPreference || options?.printPreference
    };
  }

  async function captureReadyToFinalize(response, url) {
    if (!hasJsonContentType(response)) {
      console.debug('[Interceptor] Ignorando resposta de shipments sem content-type JSON', url || response?.url || '');
      return;
    }

    const clone = response.clone();
    let data;

    try {
      data = await clone.json();
    } catch (error) {
      console.debug('[Interceptor] Resposta de shipments falhou no parse JSON', url || response?.url || '', error);
      return;
    }

    const items = resolveShipmentItems(data);
    if (!items) {
      console.debug('[Interceptor] Resposta de shipments sem lista reconhecida', {
        url: url || response?.url || '',
        keys: data && typeof data === 'object' ? Object.keys(data) : null
      });
      return;
    }

    const readyDrafts = items.filter(isReadyToFinalizeDraft);
    if (!readyDrafts.length) {
      console.log('%c[Interceptor] Nenhum draft READY_TO_FINALIZE nesta resposta', 'color: #999;', {
        totalItems: items.length
      });
      return;
    }

    window.__READY_TO_FINALIZE__ = readyDrafts;
    console.log('%cDrafts READY_TO_FINALIZE capturados', 'background: #28a745; color: white;', readyDrafts.map((item) => ({
      id: item?.id,
      draftNumber: item?.draftNumber,
      countryCode: getDraftCountry(item),
      shipmentStatus: item?.shipmentStatus
    })));
    await syncPrintPreferenceFromDrafts();
  }

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = extractUrl(args);

      if (isShipmentListUrl(url)) {
        await captureReadyToFinalize(response, url);
      }
    } catch (error) {
      console.error('Erro no interceptor:', error);
    }

    return response;
  };

  window.showReadyToFinalize = function () {
    if (window.__READY_TO_FINALIZE__?.length) {
      console.log('%cREADY_TO_FINALIZE:', 'background: #28a745; color: white;', window.__READY_TO_FINALIZE__);
      return;
    }

    console.log('(Nenhum draft encontrado)');
  };

  function createButton() {
    if (!document.body) {
      return false;
    }

    if (!hasActiveFedexSession()) {
      setReopenButtonVisible(false);
      return false;
    }

    const savedUiState = loadPanelUiState();
    if (savedUiState.closed) {
      setReopenButtonVisible(true);
      return false;
    }

    let container = document.getElementById('fedexPsdPanel');
    if (container) {
      setReopenButtonVisible(false);
      return true;
    }

    container = document.createElement('div');
    container.id = 'fedexPsdPanel';
    container.style.cssText = `
      position: fixed !important;
      top: 60px !important;
      right: 10px !important;
      z-index: 9999999 !important;
      width: 260px !important;
      padding: 12px !important;
      background: white !important;
      color: #222 !important;
      border: 2px solid #1e7e34 !important;
      border-radius: 10px !important;
      box-shadow: 0 6px 18px rgba(0,0,0,0.18) !important;
      font-family: Arial, sans-serif !important;
    `;

    const titleBar = document.createElement('div');
    titleBar.style.cssText = `
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      margin: -12px -12px 10px -12px !important;
      padding: 10px 12px !important;
      background: #f4f8f4 !important;
      border-bottom: 1px solid #d7e6d9 !important;
      border-radius: 8px 8px 0 0 !important;
      cursor: move !important;
      user-select: none !important;
    `;

    const title = document.createElement('div');
    title.textContent = 'FedEx PSDU';
    title.style.cssText = 'font-weight: bold !important;';

    const titleGroup = document.createElement('div');
    titleGroup.style.cssText = 'display: flex !important; align-items: center !important; gap: 8px !important;';
    titleGroup.appendChild(title);

    const dragHint = document.createElement('div');
    dragHint.textContent = 'Arraste';
    dragHint.style.cssText = 'font-size: 11px !important; color: #666 !important;';
    titleGroup.appendChild(dragHint);
    titleBar.appendChild(titleGroup);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex !important; align-items: center !important; gap: 6px !important;';

    const minimizeButton = createIconButton('');
    minimizeButton.innerHTML = getMinimizeIconSvg(false);
    minimizeButton.title = 'Minimizar painel';
    minimizeButton.setAttribute('aria-label', 'Minimizar painel');
    actions.appendChild(minimizeButton);

    const closeButton = createIconButton('');
    closeButton.innerHTML = getCloseIconSvg();
    closeButton.title = 'Fechar painel';
    closeButton.setAttribute('aria-label', 'Fechar painel');
    actions.appendChild(closeButton);

    titleBar.appendChild(actions);

    container.appendChild(titleBar);

    const body = document.createElement('div');
    body.id = 'fedexPsdPanelBody';
    body.style.cssText = 'display: block !important;';

    const label = document.createElement('label');
    label.textContent = 'Formato da etiqueta';
    label.style.cssText = 'display: block !important; font-size: 12px !important; margin-bottom: 6px !important;';
    body.appendChild(label);

    const select = document.createElement('select');
    select.id = 'fedexPrintMode';
    select.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
    `;
    select.innerHTML = `
      <option value="laser">Laser</option>
      <option value="thermal">Termica</option>
    `;
    select.value = uiState.printPreference.labelFormat;
    body.appendChild(select);

    const helper = document.createElement('div');
    helper.textContent = 'Laser abre PDF no navegador. Termica abre a etiqueta separada e a documentacao adicional continua em laser.';
    helper.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 10px !important; color: #555 !important;';
    body.appendChild(helper);

    const settingsTitle = document.createElement('div');
    settingsTitle.textContent = 'Credenciais FedEx do usuario';
    settingsTitle.style.cssText = 'font-size: 12px !important; font-weight: bold !important; margin: 12px 0 6px 0 !important;';
    body.appendChild(settingsTitle);

    const settingsStatus = document.createElement('div');
    settingsStatus.id = 'fedexSettingsStatus';
    settingsStatus.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important;';
    body.appendChild(settingsStatus);

    const inlineMessage = document.createElement('div');
    inlineMessage.id = 'fedexInlineMessage';
    inlineMessage.style.cssText = `
      display: none !important;
      font-size: 11px !important;
      line-height: 1.4 !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid transparent !important;
      border-radius: 6px !important;
    `;
    body.appendChild(inlineMessage);

    const userHint = document.createElement('div');
    userHint.id = 'fedexUserHint';
    userHint.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important; color: #666 !important;';
    body.appendChild(userHint);

    const backendHint = document.createElement('div');
    backendHint.id = 'fedexBackendHint';
    backendHint.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important; color: #666 !important;';
    body.appendChild(backendHint);

    const accountSummary = document.createElement('div');
    accountSummary.id = 'fedexAccountSummary';
    accountSummary.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important; color: #444 !important;';
    body.appendChild(accountSummary);

    const accountSelect = document.createElement('select');
    accountSelect.id = 'fedexAccountSelect';
    accountSelect.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
    `;
    accountSelect.addEventListener('change', async () => {
      try {
        clearInlineMessage();
        if (accountSelect.value === '__new__') {
          uiState.fedexSettingsMode = 'create';
          populateFedexSettingsForm();
          return;
        }
        await selectFedexAccount(getCurrentUserId(), accountSelect.value);
        uiState.fedexSettingsMode = uiState.fedexSettings.accounts.length ? 'summary' : 'create';
        populateFedexSettingsForm();
        updateStatusIndicators();
        loadAccountPreferences(accountSelect.value);
      } catch (error) {
        console.error('Erro ao selecionar conta FedEx:', error);
        showInlineMessage(error.message, 'error');
      }
    });
    body.appendChild(accountSelect);

    const accountActions = document.createElement('div');
    accountActions.id = 'fedexAccountActions';
    accountActions.style.cssText = 'display: flex !important; gap: 10px !important; flex-wrap: wrap !important; margin-bottom: 10px !important;';

    const editAccountLink = document.createElement('button');
    editAccountLink.id = 'fedexEditAccountLink';
    editAccountLink.type = 'button';
    editAccountLink.textContent = 'Editar';
    editAccountLink.style.cssText = 'padding: 0 !important; border: 0 !important; background: transparent !important; color: #0d6efd !important; cursor: pointer !important; font-size: 11px !important;';
    editAccountLink.addEventListener('click', () => {
      clearInlineMessage();
      uiState.fedexSettingsMode = 'edit';
      populateFedexSettingsForm();
    });
    accountActions.appendChild(editAccountLink);

    const deleteAccountLink = document.createElement('button');
    deleteAccountLink.id = 'fedexDeleteAccountLink';
    deleteAccountLink.type = 'button';
    deleteAccountLink.textContent = 'Excluir';
    deleteAccountLink.style.cssText = 'padding: 0 !important; border: 0 !important; background: transparent !important; color: #b42318 !important; cursor: pointer !important; font-size: 11px !important;';
    deleteAccountLink.addEventListener('click', async () => {
      try {
        const selectedAccount = getSelectedFedexAccount();
        if (!selectedAccount) {
          return;
        }

        clearInlineMessage();
        await deleteFedexSettings(getCurrentUserId(), selectedAccount.accountNumber);
        uiState.fedexSettingsMode = uiState.fedexSettings.accounts.length ? 'summary' : 'create';
        populateFedexSettingsForm();
        showInlineMessage(`Conta ${selectedAccount.accountNumber} removida.`, 'success');
      } catch (error) {
        console.error('Erro ao excluir conta FedEx:', error);
        showInlineMessage(error.message, 'error');
      }
    });
    accountActions.appendChild(deleteAccountLink);

    const addAccountLink = document.createElement('button');
    addAccountLink.id = 'fedexAddAccountLink';
    addAccountLink.type = 'button';
    addAccountLink.textContent = 'Adicionar nova conta';
    addAccountLink.style.cssText = 'padding: 0 !important; border: 0 !important; background: transparent !important; color: #0d6efd !important; cursor: pointer !important; font-size: 11px !important;';
    addAccountLink.addEventListener('click', () => {
      clearInlineMessage();
      uiState.fedexSettingsMode = 'create';
      populateFedexSettingsForm();
    });
    accountActions.appendChild(addAccountLink);

    body.appendChild(accountActions);

    const formSection = document.createElement('div');
    formSection.id = 'fedexSettingsFormSection';

    const apiKeyInput = document.createElement('input');
    apiKeyInput.id = 'fedexApiKey';
    apiKeyInput.type = 'text';
    apiKeyInput.placeholder = 'FedEx API Key';
    apiKeyInput.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
      box-sizing: border-box !important;
    `;
    formSection.appendChild(apiKeyInput);

    const secretKeyWrapper = document.createElement('div');
    secretKeyWrapper.style.cssText = `
      display: flex !important;
      align-items: stretch !important;
      gap: 6px !important;
      margin-bottom: 8px !important;
    `;

    const secretKeyInput = document.createElement('input');
    secretKeyInput.id = 'fedexSecretKey';
    secretKeyInput.type = 'password';
    secretKeyInput.placeholder = 'FedEx Secret Key';
    secretKeyInput.style.cssText = `
      flex: 1 !important;
      min-width: 0 !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
      box-sizing: border-box !important;
    `;
    secretKeyWrapper.appendChild(secretKeyInput);

    const toggleSecretKeyButton = document.createElement('button');
    toggleSecretKeyButton.type = 'button';
    toggleSecretKeyButton.id = 'fedexToggleSecretKey';
    toggleSecretKeyButton.innerHTML = getEyeIconSvg(false);
    toggleSecretKeyButton.title = 'Mostrar Secret Key';
    toggleSecretKeyButton.setAttribute('aria-label', 'Mostrar Secret Key');
    toggleSecretKeyButton.style.cssText = `
      flex: 0 0 auto !important;
      width: 40px !important;
      min-width: 40px !important;
      padding: 8px !important;
      background: #f4f8f4 !important;
      color: #33543a !important;
      border: 1px solid #cddfce !important;
      border-radius: 6px !important;
      cursor: pointer !important;
      font-size: 16px !important;
      font-weight: bold !important;
      line-height: 1 !important;
    `;
    toggleSecretKeyButton.addEventListener('click', () => {
      const isHidden = secretKeyInput.type === 'password';
      secretKeyInput.type = isHidden ? 'text' : 'password';
      toggleSecretKeyButton.innerHTML = getEyeIconSvg(isHidden);
      toggleSecretKeyButton.title = isHidden ? 'Ocultar Secret Key' : 'Mostrar Secret Key';
      toggleSecretKeyButton.setAttribute('aria-label', isHidden ? 'Ocultar Secret Key' : 'Mostrar Secret Key');
    });
    secretKeyWrapper.appendChild(toggleSecretKeyButton);
    formSection.appendChild(secretKeyWrapper);

    const accountNumberInput = document.createElement('input');
    accountNumberInput.id = 'fedexAccountNumber';
    accountNumberInput.type = 'text';
    accountNumberInput.placeholder = 'FedEx Account Number';
    accountNumberInput.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
      box-sizing: border-box !important;
    `;
    formSection.appendChild(accountNumberInput);

    const saveSettingsButton = document.createElement('button');
    saveSettingsButton.textContent = 'Salvar Credenciais FedEx';
    saveSettingsButton.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 10px 12px !important;
      background: #6f42c1 !important;
      color: white !important;
      border: 0 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-weight: bold !important;
    `;
    saveSettingsButton.onclick = async () => {
      try {
        const currentUserId = getCurrentUserId();
        const settings = readFedexSettingsForm();
        clearInlineMessage();
        await saveFedexSettings(currentUserId, settings);
        uiState.fedexSettingsMode = 'summary';
        populateFedexSettingsForm();
        showInlineMessage(`Conta ${settings.accountNumber} salva para ${currentUserId}.`, 'success');
      } catch (error) {
        console.error('Erro ao salvar configuracoes FedEx:', error);
        showInlineMessage(`Erro ao salvar configuracoes FedEx: ${error.message}`, 'error');
      }
    };
    formSection.appendChild(saveSettingsButton);
    body.appendChild(formSection);

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Salvar Preferencia';
    saveButton.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 10px 12px !important;
      background: #0d6efd !important;
      color: white !important;
      border: 0 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-weight: bold !important;
    `;
    saveButton.onclick = async () => {
      try {
        const preference = getCurrentPrintPreference();
        await savePrintPreference(uiState.currentUserId, preference);
        showInlineMessage(`Preferencia salva para ${uiState.currentUserId || 'usuario atual'}: ${preference.labelFormat}.`, 'success');
      } catch (error) {
        console.error('Erro ao salvar preferencia:', error);
        showInlineMessage(`Erro ao salvar preferencia: ${error.message}`, 'error');
      }
    };
    body.appendChild(saveButton);

    const cancelSectionTitle = document.createElement('div');
    cancelSectionTitle.textContent = 'Cancelar envio publico';
    cancelSectionTitle.style.cssText = 'font-size: 12px !important; font-weight: bold !important; margin: 12px 0 6px 0 !important;';
    body.appendChild(cancelSectionTitle);

    const cancelHelper = document.createElement('div');
    cancelHelper.textContent = 'Selecione um tracking gerado pela API publica para cancelar o envio.';
    cancelHelper.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important; color: #555 !important;';
    body.appendChild(cancelHelper);

    const cancelTrackingSelect = document.createElement('select');
    cancelTrackingSelect.id = 'fedexCancelTrackingSelect';
    cancelTrackingSelect.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 8px !important;
      border: 1px solid #ccc !important;
      border-radius: 6px !important;
    `;
    cancelTrackingSelect.addEventListener('change', () => {
      uiState.selectedCancellationTracking = cancelTrackingSelect.value || '';
      populateCancellationOptions();
    });
    body.appendChild(cancelTrackingSelect);

    const cancelHint = document.createElement('div');
    cancelHint.id = 'fedexCancelHint';
    cancelHint.style.cssText = 'font-size: 11px !important; line-height: 1.4 !important; margin-bottom: 8px !important; color: #666 !important;';
    body.appendChild(cancelHint);

    const cancelButton = document.createElement('button');
    cancelButton.id = 'fedexCancelShipmentButton';
    cancelButton.textContent = 'Cancelar tracking selecionado';
    cancelButton.style.cssText = `
      width: 100% !important;
      margin-bottom: 8px !important;
      padding: 10px 12px !important;
      background: #b42318 !important;
      color: white !important;
      border: 0 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-weight: bold !important;
    `;
    cancelButton.onclick = async () => {
      const selectedAccount = getSelectedFedexAccount();

      try {
        clearInlineMessage();

        if (!selectedAccount) {
          throw new Error('Selecione uma conta FedEx antes de cancelar');
        }

        if (!uiState.selectedCancellationTracking) {
          throw new Error('Selecione um tracking para cancelar');
        }

        cancelButton.disabled = true;
        cancelButton.textContent = 'Cancelando...';

        await cancelShipment(uiState.selectedCancellationTracking, selectedAccount.accountNumber);
        await refreshCancelableShipments();
        showInlineMessage(`Tracking ${uiState.selectedCancellationTracking} cancelado com sucesso.`, 'success');
      } catch (error) {
        console.error('Erro ao cancelar tracking:', error);
        showInlineMessage(`Erro ao cancelar tracking: ${error.message}`, 'error');
      } finally {
        cancelButton.disabled = false;
        cancelButton.textContent = 'Cancelar tracking selecionado';
        populateCancellationOptions();
      }
    };
    body.appendChild(cancelButton);

    const button = document.createElement('button');
    button.id = 'btnEnviarDrafts';
    button.textContent = 'Enviar e Imprimir Drafts';
    button.style.cssText = `
      width: 100% !important;
      padding: 12px 16px !important;
      background: #28a745 !important;
      color: white !important;
      border: 0 !important;
      border-radius: 8px !important;
      cursor: pointer !important;
      font-weight: bold !important;
    `;

    button.onclick = async () => {
      if (!window.__READY_TO_FINALIZE__?.length) {
        alert('Nenhum draft encontrado.');
        return;
      }

      button.disabled = true;
      button.textContent = 'Processando...';

      try {
        await syncPrintPreferenceFromDrafts();
        const printPreference = getCurrentPrintPreference();

        if (!uiState.fedexSettings.configured) {
          throw new Error('Configure API Key, Secret Key e Account Number antes de enviar os drafts');
        }

        const results = [];
        const selectedAccount = getSelectedFedexAccount();

        for (let index = 0; index < window.__READY_TO_FINALIZE__.length; index++) {
          const result = await processDraftEndToEnd(
            window.__READY_TO_FINALIZE__[index],
            index,
            window.__READY_TO_FINALIZE__.length,
            {
              printPreference,
              accountNumber: selectedAccount?.accountNumber || ''
            }
          );

          results.push(result);
        }

        console.log('%cProcessamento concluido', 'background: #28a745; color: white;', results);
        await refreshCancelableShipments();
        showInlineMessage(`Sucesso: ${results.length} draft(s) enviados em modo ${printPreference.labelFormat}.`, 'success');
      } catch (error) {
        console.error('Erro no fluxo completo:', error);
        showInlineMessage(`Erro no fluxo completo: ${error.message}`, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Enviar e Imprimir Drafts';
      }
    };

    body.appendChild(button);
    container.appendChild(body);
    document.body.appendChild(container);
    populateFedexSettingsForm();
    refreshCancelableShipments();
    ensureCurrentUserId();
    setReopenButtonVisible(false);
    applyPanelPosition(container, loadSavedPanelPosition());
    enablePanelDragging(container, titleBar);

    const updatePanelUi = (nextState) => {
      body.style.display = nextState.minimized ? 'none' : 'block';
      minimizeButton.innerHTML = getMinimizeIconSvg(nextState.minimized);
      minimizeButton.title = nextState.minimized ? 'Expandir painel' : 'Minimizar painel';
      minimizeButton.setAttribute('aria-label', nextState.minimized ? 'Expandir painel' : 'Minimizar painel');
      container.style.paddingBottom = nextState.minimized ? '0px' : '12px';
      savePanelUiState(nextState);
    };

    let panelUiState = savedUiState;
    updatePanelUi(panelUiState);

    minimizeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      panelUiState = {
        ...panelUiState,
        minimized: !panelUiState.minimized,
        closed: false
      };
      updatePanelUi(panelUiState);
    });

    closeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      panelUiState = {
        ...panelUiState,
        closed: true
      };
      savePanelUiState(panelUiState);
      container.remove();
      setReopenButtonVisible(true);
    });

    [minimizeButton, closeButton].forEach((buttonElement) => {
      buttonElement.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
      });
    });

    return true;
  }

  function setupReopenButton() {
    const reopenButton = createReopenButton();
    if (!reopenButton) {
      return;
    }

    reopenButton.addEventListener('click', () => {
      savePanelUiState({
        ...loadPanelUiState(),
        closed: false
      });
      createButton();
      setReopenButtonVisible(false);
    });

    setReopenButtonVisible(loadPanelUiState().closed);
  }

  setupReopenButton();
  createButton();
  setTimeout(createButton, 500);
  setTimeout(createButton, 1000);
  setTimeout(createButton, 2000);

  const scheduleSessionCheck = () => {
    window.setTimeout(() => {
      verifySessionAndTogglePanel();
    }, 100);
  };

  window.addEventListener('focus', scheduleSessionCheck);
  window.addEventListener('pageshow', scheduleSessionCheck);
  window.addEventListener('popstate', scheduleSessionCheck);
  window.addEventListener('hashchange', scheduleSessionCheck);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleSessionCheck();
    }
  });

  setInterval(() => {
    verifySessionAndTogglePanel();
  }, 3000);
})();
