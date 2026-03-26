const printPreferenceService = require('../services/printPreferenceService');

module.exports = {
    getPrintPreference(req, res) {
        try {
            const preference = printPreferenceService.getByUserId(req.params.userId);
            res.json(preference);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    savePrintPreference(req, res) {
        try {
            const preference = printPreferenceService.saveByUserId(req.params.userId, req.body || {});
            res.json(preference);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
};
