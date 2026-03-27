require('dotenv').config();
const fs = require('fs');
const https = require('https');
const path = require('path');
const axios = require('axios');
const { setTimeout: sleep } = require('timers/promises');

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    console.warn('NODE_TLS_REJECT_UNAUTHORIZED=0 foi removido para manter a verificacao TLS ativa.');
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main() {
    const backendUrl = String(process.env.RENDER_SYNC_BASE_URL || 'https://fedex-shipping-api.onrender.com').trim().replace(/\/+$/, '');
    const importToken = String(process.env.ADMIN_IMPORT_TOKEN || '').trim();
    const preferencesDir = String(process.env.PREFERENCES_DIR || path.join(process.cwd(), 'storage', 'preferences'));
    const fedexSettingsPath = path.join(preferencesDir, 'fedex-settings.json');
    const printPreferencesPath = path.join(preferencesDir, 'print-preferences.json');
    const requestTimeoutMs = Number(process.env.RENDER_SYNC_TIMEOUT_MS || 60000);
    const maxAttempts = Number(process.env.RENDER_SYNC_MAX_ATTEMPTS || 3);
    const allowInsecureTls = String(process.env.RENDER_SYNC_INSECURE_TLS || '').trim() === '1';

    if (!importToken) {
        throw new Error('Defina ADMIN_IMPORT_TOKEN no ambiente local antes de sincronizar');
    }

    if (allowInsecureTls) {
        console.warn('RENDER_SYNC_INSECURE_TLS=1 ativo apenas para este script. Corrija o certificado local assim que possivel.');
    }

    const payload = {
        fedexSettings: readJsonFile(fedexSettingsPath),
        printPreferences: readJsonFile(printPreferencesPath)
    };

    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(`Sincronizando preferencias com o Render (tentativa ${attempt}/${maxAttempts})...`);

            const response = await axios.post(`${backendUrl}/api/v1/admin/import/preferences`, payload, {
                timeout: requestTimeoutMs,
                httpsAgent: allowInsecureTls
                    ? new https.Agent({ rejectUnauthorized: false })
                    : undefined,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${importToken}`
                }
            });

            console.log(JSON.stringify(response.data, null, 2));
            return;
        } catch (error) {
            lastError = error;

            if (attempt === maxAttempts) {
                break;
            }

            const delayMs = attempt * 10000;
            console.warn(`Tentativa ${attempt} falhou. Nova tentativa em ${delayMs / 1000}s...`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}

main().catch((error) => {
    const message = error.response?.data || error.message;
    console.error('Falha ao sincronizar preferencias com o Render');
    console.error(typeof message === 'string' ? message : JSON.stringify(message, null, 2));
    process.exit(1);
});
