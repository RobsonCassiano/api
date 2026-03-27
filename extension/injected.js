(function() {
  console.log('%cFedEx Interceptor iniciando...', 'color: #ff6600; font-weight: bold;');

  const originalFetch = window.fetch;
  const BACKEND_BASE_URL = 'https://fedex-shipping-api.onrender.com';
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

  function getCurrentUserId() {
    return uiState.currentUserId || getUserIdFromPageCookies() || getDraftUserId(window.__READY_TO_FINALIZE__?.[0]) || null;
  }

  async function syncUserState(userId) {
    const normalizedUserId = String(userId || '').trim();

    if (!normalizedUserId) {
      return null;
    }

    uiState.currentUserId = normalizedUserId;
    uiState.printPreference = await fetchPrintPreference(normalizedUserId);
    uiState.fedexSettings = await fetchFedexSettings(normalizedUserId);
    uiState.fedexSettingsMode = uiState.fedexSettings.accounts?.length ? 'summary' : 'create';

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

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/print-preferences`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao carregar preferencia de impressao (HTTP ${response.status})`);
    }

    return {
      ...DEFAULT_PRINT_PREFERENCE,
      ...(data || {})
    };
  }

  async function fetchFedexSettings(userId) {
    if (!userId) {
      return { ...DEFAULT_FEDEX_SETTINGS };
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/fedex-settings`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      uiState.backendStatus = {
        source: BACKEND_BASE_URL,
        lastSyncOk: false,
        lastSyncMessage: `Falha ao carregar credenciais (${response.status})`
      };
      throw new Error(data?.error || `Falha ao carregar configuracoes FedEx (HTTP ${response.status})`);
    }

    uiState.backendStatus = {
      source: BACKEND_BASE_URL,
      lastSyncOk: true,
      lastSyncMessage: data?.configured
        ? `Credenciais carregadas: ${data.accounts?.length || 0} conta(s)`
        : 'Nenhuma credencial encontrada no backend'
    };

    return {
      ...DEFAULT_FEDEX_SETTINGS,
      ...(data || {})
    };
  }

  async function savePrintPreference(userId, preference) {
    userId = userId || await ensureCurrentUserId();

    if (!userId) {
      return;
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/print-preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preference)
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao salvar preferencia de impressao (HTTP ${response.status})`);
    }

    uiState.printPreference = {
      ...DEFAULT_PRINT_PREFERENCE,
      ...(data || {})
    };
  }

  async function saveFedexSettings(userId, settings) {
    userId = userId || await ensureCurrentUserId();

    if (!userId) {
      throw new Error('Usuario FedEx nao identificado na tela atual');
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/fedex-settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao salvar configuracoes FedEx (HTTP ${response.status})`);
    }

    uiState.fedexSettings = {
      ...DEFAULT_FEDEX_SETTINGS,
      ...(data || {})
    };
  }

  async function selectFedexAccount(userId, accountNumber) {
    userId = userId || await ensureCurrentUserId();

    if (!userId) {
      throw new Error('Usuario FedEx nao identificado na tela atual');
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/fedex-settings/select`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountNumber })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao selecionar conta FedEx (HTTP ${response.status})`);
    }

    uiState.fedexSettings = {
      ...DEFAULT_FEDEX_SETTINGS,
      ...(data || {})
    };
  }

  async function deleteFedexSettings(userId, accountNumber) {
    userId = userId || await ensureCurrentUserId();

    if (!userId) {
      throw new Error('Usuario FedEx nao identificado na tela atual');
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/users/${encodeURIComponent(userId)}/fedex-settings/${encodeURIComponent(accountNumber)}`, {
      method: 'DELETE'
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao excluir conta FedEx (HTTP ${response.status})`);
    }

    uiState.fedexSettings = {
      ...DEFAULT_FEDEX_SETTINGS,
      ...(data || {})
    };
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
      userHint.textContent = `Usuario atual: ${getCurrentUserId() || 'aguardando captura do draft'}`;
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
      const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/drafts`);
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || `Falha ao carregar drafts processados (HTTP ${response.status})`);
      }

      const drafts = Array.isArray(data?.drafts) ? data.drafts : [];
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
    const userId = await ensureCurrentUserId();

    if (!userId) {
      throw new Error('Usuario FedEx nao identificado na tela atual');
    }

    if (!trackingNumber) {
      throw new Error('Selecione um tracking para cancelar');
    }

    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/fedex/shipments/cancel`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        accountNumber,
        trackingNumber
      })
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao cancelar shipment (HTTP ${response.status})`);
    }

    return data;
  }

  async function syncPrintPreferenceFromDrafts() {
    const nextUserId = getDraftUserId(window.__READY_TO_FINALIZE__?.[0]);

    if (!nextUserId || nextUserId === uiState.currentUserId) {
      return;
    }

    await syncUserState(nextUserId);
  }

  async function saveDraftToBackend(draft) {
    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/drafts/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.draft?.id) {
      throw new Error(data?.error || `Falha ao salvar draft (HTTP ${response.status})`);
    }

    return data.draft;
  }

  async function sendDraftToFedex(localDraftId, options = {}) {
    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/drafts/${localDraftId}/send-to-fedex`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || data?.details || `Falha ao enviar draft para FedEx (HTTP ${response.status})`);
    }

    return data;
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
    const response = await originalFetch(`${BACKEND_BASE_URL}/api/v1/drafts/${encodeURIComponent(draftId)}/documents/encoded`);
    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Falha ao carregar documentos codificados (HTTP ${response.status})`);
    }

    return data;
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

  window.fetch = async function(...args) {
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

  window.showReadyToFinalize = function() {
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

  setInterval(() => {
    setReopenButtonVisible(loadPanelUiState().closed);
    if (!document.getElementById('fedexPsdPanel') && document.body) {
      createButton();
    }
  }, 3000);
})();
