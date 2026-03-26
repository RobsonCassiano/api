const express = require('express');

const orderController = require('../controllers/orderController');
const fedexController = require('../controllers/fedexController');
const shopifyController = require('../controllers/shopifyController');
const draftController = require('../controllers/draftController');
const printPreferenceController = require('../controllers/printPreferenceController');
const fedexSettingsController = require('../controllers/fedexSettingsController');

const router = express.Router();

// ========== SHOPIFY ==========
router.get('/api/v1/shopify/orders', shopifyController.getShopifyOrders);
router.put('/api/v1/shopify/orders/:id', shopifyController.updateShopifyOrder);
router.post('/api/v1/shopify/orders/:id/close', shopifyController.closeShopifyOrder);
router.post('/api/v1/shopify/orders/:id/open', shopifyController.openShopifyOrder);
router.post('/api/v1/shopify/orders/:id/cancel', shopifyController.cancelShopifyOrder);
router.post('/api/v1/shopify/orders/:id/mark-paid', shopifyController.markShopifyOrderAsPaid);

// ========== FEDEX ==========
router.post('/api/v1/fedex/shipments', fedexController.createFedexShipment);
router.put('/api/v1/fedex/shipments/cancel', fedexController.cancelFedexShipment);
router.get('/api/v1/fedex/tracking/:trackingNumber', fedexController.trackFedexShipment);
router.get('/api/v1/fedex/token-status', fedexController.getTokenStatus);
router.delete('/api/v1/fedex/token-cache', fedexController.clearTokenCache);

// ========== DRAFTS ==========
router.post('/api/v1/drafts/save', draftController.saveDraft);
router.get('/api/v1/drafts', draftController.getAllDrafts);
router.get('/api/v1/drafts/:id', draftController.getDraftById);
router.get('/api/v1/drafts/:id/documents', draftController.getDraftDocuments);
router.get('/api/v1/drafts/:id/documents/open', draftController.openDraftDocument);
router.post('/api/v1/drafts/:id/send-to-fedex', draftController.sendDraftToFedex);
router.post('/api/v1/drafts/:id/mark-finalized', draftController.markDraftAsFinalizedInUi);
router.delete('/api/v1/drafts/:id', draftController.deleteDraft);

// ========== PRINT PREFERENCES ==========
router.get('/api/v1/users/:userId/print-preferences', printPreferenceController.getPrintPreference);
router.put('/api/v1/users/:userId/print-preferences', printPreferenceController.savePrintPreference);

// ========== FEDEX SETTINGS ==========
router.get('/api/v1/users/:userId/fedex-settings', fedexSettingsController.getFedexSettings);
router.put('/api/v1/users/:userId/fedex-settings', fedexSettingsController.saveFedexSettings);
router.put('/api/v1/users/:userId/fedex-settings/select', fedexSettingsController.selectFedexAccount);
router.delete('/api/v1/users/:userId/fedex-settings/:accountNumber', fedexSettingsController.deleteFedexSettings);

// ========== ORDERS ==========
router.post('/api/v1/orders/process', orderController.processOrder);
router.get('/api/v1/orders', orderController.getProcessedOrders);
router.get('/api/v1/orders/:id', orderController.getProcessedOrderById);

module.exports = router;
