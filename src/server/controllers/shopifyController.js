const shopifyService = require('../services/shopifyService');
const asyncHandler = require('../utils/asyncHandler');

module.exports = {
    /**
     * Listar pedidos do Shopify
     */
    getShopifyOrders: asyncHandler(async (req, res) => {
        const orders = await shopifyService.getOrders();
        res.json(orders);
    }),

    updateShopifyOrder: asyncHandler(async (req, res) => {
        const order = await shopifyService.updateOrder(req.params.id, req.body || {});
        res.json(order);
    }),

    closeShopifyOrder: asyncHandler(async (req, res) => {
        const order = await shopifyService.closeOrder(req.params.id);
        res.json(order);
    }),

    openShopifyOrder: asyncHandler(async (req, res) => {
        const order = await shopifyService.openOrder(req.params.id);
        res.json(order);
    }),

    cancelShopifyOrder: asyncHandler(async (req, res) => {
        const order = await shopifyService.cancelOrder(req.params.id, req.body || {});
        res.json(order);
    }),

    markShopifyOrderAsPaid: asyncHandler(async (req, res) => {
        const result = await shopifyService.markOrderAsPaid(req.params.id, req.body || {});
        res.json(result);
    })
};
