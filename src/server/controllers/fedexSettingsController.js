const fedexSettingsService = require('../services/fedexSettingsService');

module.exports = {
    getFedexSettings(req, res) {
        try {
            const settings = fedexSettingsService.getByUserId(req.params.userId);
            res.json(settings);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    },

    saveFedexSettings(req, res) {
        try {
            const settings = fedexSettingsService.saveByUserId(req.params.userId, req.body || {});
            res.json(settings);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    selectFedexAccount(req, res) {
        try {
            const settings = fedexSettingsService.selectAccountByUserId(
                req.params.userId,
                req.body?.accountNumber
            );
            res.json(settings);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    },

    deleteFedexSettings(req, res) {
        try {
            const settings = fedexSettingsService.deleteByUserIdAndAccountNumber(
                req.params.userId,
                req.params.accountNumber
            );
            res.json(settings);
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    }
};
