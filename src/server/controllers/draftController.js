const draftService = require('../services/draftService');
const logger = require('../utils/logger');

module.exports = {
    /**
     * Salvar draft da extensão
     * POST /api/v1/drafts/save
     */
    async saveDraft(req, res) {
        try {
            const draftData = req.body;

            if (!draftData) {
                return res.status(400).json({ 
                    error: 'Dados do draft são obrigatórios' 
                });
            }

            const savedDraft = await draftService.saveDraft(draftData);
            
            res.status(201).json({
                message: 'Draft salvo com sucesso',
                draft: savedDraft
            });

        } catch (error) {
            logger.error('Erro em saveDraft controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Obter todos os drafts
     * GET /api/v1/drafts
     */
    async getAllDrafts(req, res) {
        try {
            const drafts = await draftService.getAllDrafts();
            
            res.json({
                total: drafts.length,
                drafts
            });

        } catch (error) {
            logger.error('Erro em getAllDrafts controller:', error.message);
            res.status(500).json({ error: error.message });
        }
    },

    /**
     * Obter draft por ID
     * GET /api/v1/drafts/:id
     */
    async getDraftById(req, res) {
        try {
            const { id } = req.params;
            const draft = await draftService.getDraftById(id);
            
            res.json(draft);

        } catch (error) {
            logger.error('Erro em getDraftById controller:', error.message);
            res.status(404).json({ error: error.message });
        }
    },

    /**
     * Obter links de documentos do draft
     * GET /api/v1/drafts/:id/documents
     */
    async getDraftDocuments(req, res) {
        try {
            const { id } = req.params;
            const documents = await draftService.getDraftDocuments(id);

            res.json(documents);

        } catch (error) {
            logger.error('Erro em getDraftDocuments controller:', error.message);
            res.status(404).json({ error: error.message });
        }
    },

    /**
     * Redirecionar para o melhor documento disponivel do draft
     * GET /api/v1/drafts/:id/documents/open
     */
    async openDraftDocument(req, res) {
        try {
            const { id } = req.params;
            const document = await draftService.getPreferredDraftDocument(id, req.query.type || 'preferred', {
                autoPrint: req.query.autoPrint === 'true'
            });

            res.redirect(document.preferredUrl);

        } catch (error) {
            logger.error('Erro em openDraftDocument controller:', error.message);
            res.status(404).json({ error: error.message });
        }
    },

    /**
     * Processar draft e enviar para FedEx
     * POST /api/v1/drafts/:id/send-to-fedex
     */
    async sendDraftToFedex(req, res) {
        try {
            const { id } = req.params;
            
            logger.info(`📤 Iniciando envio do draft ${id} para FedEx...`);
            
            const result = await draftService.processDraftAndSendToFedex(id, req.body || {});
            
            res.json({
                message: 'Draft processado e enviado com sucesso',
                ...result
            });

        } catch (error) {
            logger.error('Erro em sendDraftToFedex controller:', error.message);
            res.status(500).json({ 
                error: error.message,
                details: 'Falha ao processar e enviar draft para FedEx'
            });
        }
    },

    async markDraftAsFinalizedInUi(req, res) {
        try {
            const { id } = req.params;
            const draft = await draftService.markDraftAsFinalizedInUi(id, req.body || {});

            res.json({
                message: 'Draft marcado como finalizado na UI FedEx',
                draft
            });
        } catch (error) {
            logger.error('Erro em markDraftAsFinalizedInUi controller:', error.message);
            res.status(500).json({
                error: error.message
            });
        }
    },

    /**
     * Deletar draft
     * DELETE /api/v1/drafts/:id
     */
    async deleteDraft(req, res) {
        try {
            const { id } = req.params;
            const result = await draftService.deleteDraft(id);
            
            res.json(result);

        } catch (error) {
            logger.error('Erro em deleteDraft controller:', error.message);
            res.status(404).json({ error: error.message });
        }
    }
};
