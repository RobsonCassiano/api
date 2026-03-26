const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

const DATA_DIR = process.env.PREFERENCES_DIR
    ? path.resolve(process.env.PREFERENCES_DIR)
    : path.join(process.cwd(), 'storage', 'preferences');
const DATA_FILE = path.join(DATA_DIR, 'fedex-settings.json');

function ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
    }
}

function loadSettings() {
    ensureStorage();

    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        logger.error('Erro ao carregar configuracoes FedEx', error.message);
        return {};
    }
}

function saveSettings(settings) {
    ensureStorage();
    fs.writeFileSync(DATA_FILE, JSON.stringify(settings, null, 2));
}

function normalizeUserId(userId) {
    return String(userId || '').trim();
}

function normalizeAccountNumber(accountNumber) {
    return String(accountNumber || '').trim();
}

function normalizeSettings(input = {}) {
    return {
        accountNumber: normalizeAccountNumber(input.accountNumber),
        apiKey: String(input.apiKey || '').trim(),
        secretKey: String(input.secretKey || '').trim()
    };
}

function normalizeUserRecord(record = {}) {
    const accounts = Array.isArray(record.accounts)
        ? record.accounts
            .map((item) => normalizeSettings(item))
            .filter((item) => item.accountNumber)
        : [];

    const selectedAccountNumber = normalizeAccountNumber(record.selectedAccountNumber);
    const hasSelectedAccount = accounts.some((item) => item.accountNumber === selectedAccountNumber);

    return {
        selectedAccountNumber: hasSelectedAccount
            ? selectedAccountNumber
            : (accounts[0]?.accountNumber || ''),
        accounts
    };
}

function buildResponse(userId, record) {
    const normalized = normalizeUserRecord(record);
    const selectedAccount = normalized.accounts.find((item) => item.accountNumber === normalized.selectedAccountNumber) || null;

    return {
        userId,
        selectedAccountNumber: normalized.selectedAccountNumber || '',
        configured: normalized.accounts.length > 0,
        accounts: normalized.accounts.map((item) => ({
            accountNumber: item.accountNumber,
            apiKey: item.apiKey,
            secretKey: item.secretKey,
            configured: Boolean(item.apiKey && item.secretKey && item.accountNumber)
        })),
        selectedAccount: selectedAccount
            ? {
                ...selectedAccount,
                configured: true
            }
            : null
    };
}

module.exports = {
    getByUserId(userId) {
        const normalizedUserId = normalizeUserId(userId);

        if (!normalizedUserId) {
            return {
                userId: null,
                selectedAccountNumber: '',
                configured: false,
                accounts: [],
                selectedAccount: null
            };
        }

        const settings = loadSettings();
        return buildResponse(normalizedUserId, settings[normalizedUserId] || {});
    },

    saveByUserId(userId, input = {}) {
        const normalizedUserId = normalizeUserId(userId);

        if (!normalizedUserId) {
            throw new Error('userId e obrigatorio');
        }

        const nextSettings = normalizeSettings(input);

        if (!nextSettings.apiKey || !nextSettings.secretKey || !nextSettings.accountNumber) {
            throw new Error('apiKey, secretKey e accountNumber sao obrigatorios');
        }

        const settings = loadSettings();
        const currentRecord = normalizeUserRecord(settings[normalizedUserId] || {});
        const nextAccounts = currentRecord.accounts.filter((item) => item.accountNumber !== nextSettings.accountNumber);
        nextAccounts.push(nextSettings);

        settings[normalizedUserId] = {
            selectedAccountNumber: nextSettings.accountNumber,
            accounts: nextAccounts.sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
        };

        saveSettings(settings);

        logger.info('Configuracoes FedEx salvas', {
            userId: normalizedUserId,
            accountNumber: nextSettings.accountNumber
        });

        return buildResponse(normalizedUserId, settings[normalizedUserId]);
    },

    deleteByUserIdAndAccountNumber(userId, accountNumber) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

        if (!normalizedUserId || !normalizedAccountNumber) {
            throw new Error('userId e accountNumber sao obrigatorios');
        }

        const settings = loadSettings();
        const currentRecord = normalizeUserRecord(settings[normalizedUserId] || {});
        const nextAccounts = currentRecord.accounts.filter((item) => item.accountNumber !== normalizedAccountNumber);

        if (nextAccounts.length === currentRecord.accounts.length) {
            throw new Error(`Conta FedEx nao encontrada: ${normalizedAccountNumber}`);
        }

        settings[normalizedUserId] = {
            selectedAccountNumber: nextAccounts[0]?.accountNumber || '',
            accounts: nextAccounts
        };

        saveSettings(settings);

        logger.info('Configuracoes FedEx removidas', {
            userId: normalizedUserId,
            accountNumber: normalizedAccountNumber
        });

        return buildResponse(normalizedUserId, settings[normalizedUserId]);
    },

    selectAccountByUserId(userId, accountNumber) {
        const normalizedUserId = normalizeUserId(userId);
        const normalizedAccountNumber = normalizeAccountNumber(accountNumber);

        if (!normalizedUserId || !normalizedAccountNumber) {
            throw new Error('userId e accountNumber sao obrigatorios');
        }

        const settings = loadSettings();
        const currentRecord = normalizeUserRecord(settings[normalizedUserId] || {});
        const account = currentRecord.accounts.find((item) => item.accountNumber === normalizedAccountNumber);

        if (!account) {
            throw new Error(`Conta FedEx nao encontrada: ${normalizedAccountNumber}`);
        }

        settings[normalizedUserId] = {
            ...currentRecord,
            selectedAccountNumber: normalizedAccountNumber
        };

        saveSettings(settings);
        return buildResponse(normalizedUserId, settings[normalizedUserId]);
    },

    requireSelectedAccountByUserId(userId, preferredAccountNumber = null) {
        const settings = this.getByUserId(userId);
        const requestedAccountNumber = normalizeAccountNumber(preferredAccountNumber) || settings.selectedAccountNumber;
        const selectedAccount = settings.accounts.find((item) => item.accountNumber === requestedAccountNumber) || null;

        if (!selectedAccount) {
            throw new Error(`Configuracoes FedEx nao encontradas para o usuario ${userId}`);
        }

        return {
            userId,
            ...selectedAccount,
            configured: true
        };
    }
};
