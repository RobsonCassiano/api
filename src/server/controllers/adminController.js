const fedexSettingsService = require('../services/fedexSettingsService');
const printPreferenceService = require('../services/printPreferenceService');
const logger = require('../utils/logger');

function getImportToken() {
    return String(process.env.ADMIN_IMPORT_TOKEN || '').trim();
}

function isAuthorized(req) {
    const configuredToken = getImportToken();

    if (!configuredToken) {
        throw new Error('ADMIN_IMPORT_TOKEN nao configurado no servidor');
    }

    const bearerToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const headerToken = String(req.headers['x-admin-import-token'] || '').trim();
    const requestToken = bearerToken || headerToken;

    return requestToken && requestToken === configuredToken;
}

module.exports = {
    importPreferences(req, res) {
        try {
            if (!isAuthorized(req)) {
                return res.status(401).json({ error: 'Nao autorizado' });
            }

            const fedexSettings = req.body?.fedexSettings || {};
            const printPreferences = req.body?.printPreferences || {};

            const fedexResult = fedexSettingsService.importRecords(fedexSettings);
            const printResult = printPreferenceService.importRecords(printPreferences);

            res.json({
                message: 'Preferencias importadas com sucesso',
                fedexSettings: fedexResult,
                printPreferences: printResult
            });
        } catch (error) {
            logger.error('Erro em importPreferences controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
};
