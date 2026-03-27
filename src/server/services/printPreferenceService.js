const fs = require('fs');
const path = require('path');

const logger = require('../utils/logger');

const DATA_DIR = process.env.PREFERENCES_DIR
    ? path.resolve(process.env.PREFERENCES_DIR)
    : path.join(process.cwd(), 'storage', 'preferences');
const DATA_FILE = path.join(DATA_DIR, 'print-preferences.json');

const DEFAULT_PRINT_PREFERENCE = {
    labelFormat: 'laser',
    autoOpenDocuments: true,
    additionalDocsFormat: 'laser'
};

function ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
    }
}

function loadPreferences() {
    ensureStorage();

    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        logger.error('Erro ao carregar preferencias de impressao', error.message);
        return {};
    }
}

function savePreferences(preferences) {
    ensureStorage();
    fs.writeFileSync(DATA_FILE, JSON.stringify(preferences, null, 2));
}

function normalizePrintPreference(input = {}) {
    const labelFormat = input.labelFormat === 'thermal' ? 'thermal' : 'laser';

    return {
        labelFormat,
        autoOpenDocuments: input.autoOpenDocuments !== false,
        additionalDocsFormat: 'laser'
    };
}

function normalizeUserId(userId) {
    return String(userId || '').trim();
}

module.exports = {
    DEFAULT_PRINT_PREFERENCE,

    normalizePrintPreference,

    getByUserId(userId) {
        const normalizedUserId = normalizeUserId(userId);

        if (!normalizedUserId) {
            return {
                userId: null,
                ...DEFAULT_PRINT_PREFERENCE
            };
        }

        const preferences = loadPreferences();
        return {
            userId: normalizedUserId,
            ...DEFAULT_PRINT_PREFERENCE,
            ...(preferences[normalizedUserId] || {})
        };
    },

    saveByUserId(userId, input = {}) {
        const normalizedUserId = normalizeUserId(userId);

        if (!normalizedUserId) {
            throw new Error('userId e obrigatorio');
        }

        const preferences = loadPreferences();
        const nextPreference = normalizePrintPreference(input);

        preferences[normalizedUserId] = nextPreference;
        savePreferences(preferences);

        logger.info('Preferencia de impressao salva', {
            userId: normalizedUserId,
            labelFormat: nextPreference.labelFormat
        });

        return {
            userId: normalizedUserId,
            ...nextPreference
        };
    },

    importRecords(records = {}) {
        const nextRecords = records && typeof records === 'object' ? records : {};
        const preferences = loadPreferences();
        let importedUsers = 0;

        Object.entries(nextRecords).forEach(([userId, record]) => {
            const normalizedUserId = normalizeUserId(userId);

            if (!normalizedUserId) {
                return;
            }

            preferences[normalizedUserId] = normalizePrintPreference(record);
            importedUsers += 1;
        });

        savePreferences(preferences);

        logger.info('Preferencias de impressao importadas', {
            importedUsers
        });

        return {
            importedUsers
        };
    }
};
