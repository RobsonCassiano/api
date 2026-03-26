const fedexService = require('../services/fedexService');
const { getTokenCacheStatus, clearTokenCache } = require('../clients/fedexClient');
const logger = require('../utils/logger');

module.exports = {
    /**
     * Criar envio no FedEx
     */
    async createFedexShipment(req, res) {
        try {
            const shipment = await fedexService.createShipment(req.body);
            res.json(shipment);
        } catch (error) {
            logger.error('Erro em createFedexShipment controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Rastrear envio FedEx
     */
    async trackFedexShipment(req, res) {
        try {
            const tracking = await fedexService.trackShipment(req.params.trackingNumber);
            res.json(tracking);
        } catch (error) {
            logger.error('Erro em trackFedexShipment controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Status do cache de token FedEx
     */
    getTokenStatus(req, res) {
        try {
            const status = getTokenCacheStatus();
            res.json(status);
        } catch (error) {
            logger.error('Erro em getTokenStatus controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Limpar cache de token FedEx
     */
    clearTokenCache(req, res) {
        try {
            clearTokenCache();
            res.json({ message: 'Token cache cleared' });
        } catch (error) {
            logger.error('Erro em clearTokenCache controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    }
};
