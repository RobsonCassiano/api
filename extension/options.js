const DEFAULT_BACKEND_BASE_URL = 'https://fedex-shipping-api.onrender.com';

function normalizeBackendBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function setStatus(message, type = '') {
  const status = document.getElementById('status');
  status.textContent = message;
  status.className = type;
}

function loadConfig() {
  chrome.runtime.sendMessage({ type: 'GET_BACKEND_CONFIG' }, (response) => {
    const backendBaseUrlInput = document.getElementById('backendBaseUrl');
    backendBaseUrlInput.value = response?.backendBaseUrl || DEFAULT_BACKEND_BASE_URL;
  });
}

function saveConfig(value) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'SET_BACKEND_CONFIG', backendBaseUrl: value },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response?.ok) {
          reject(new Error(response?.error || 'Nao foi possivel salvar a configuracao'));
          return;
        }

        resolve(response.backendBaseUrl);
      }
    );
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const backendBaseUrlInput = document.getElementById('backendBaseUrl');
  const saveButton = document.getElementById('saveButton');
  const resetButton = document.getElementById('resetButton');

  loadConfig();

  saveButton.addEventListener('click', async () => {
    try {
      const normalizedValue = normalizeBackendBaseUrl(backendBaseUrlInput.value);

      if (!normalizedValue || !/^https?:\/\//i.test(normalizedValue)) {
        throw new Error('Informe uma URL valida com http:// ou https://');
      }

      const savedValue = await saveConfig(normalizedValue);
      backendBaseUrlInput.value = savedValue;
      setStatus('Backend salvo com sucesso. Recarregue a pagina da FedEx.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  resetButton.addEventListener('click', async () => {
    try {
      const savedValue = await saveConfig(DEFAULT_BACKEND_BASE_URL);
      backendBaseUrlInput.value = savedValue;
      setStatus('Configuracao padrao restaurada. Recarregue a pagina da FedEx.', 'success');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });
});
