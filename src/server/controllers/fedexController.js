const fedexService = require('../services/fedexService');
const draftService = require('../services/draftService');
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

    async cancelFedexShipment(req, res) {
        try {
            const result = await fedexService.cancelShipment(req.body || {});
            let draft = null;

            try {
                draft = draftService.markDraftAsCancelledByTrackingNumber(result.trackingNumber, {
                    accountNumber: result.accountNumber,
                    response: result.response
                });
            } catch (error) {
                logger.warn('Cancelamento realizado, mas nao foi possivel atualizar draft local', error.message);
            }

            res.json({
                message: 'Shipment cancelado com sucesso',
                ...result,
                draft
            });
        } catch (error) {
            logger.error('Erro em cancelFedexShipment controller:', error.message);
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
