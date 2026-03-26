const orderService = require('../services/orderService');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

module.exports = {
    processOrder: asyncHandler(async (req, res) => {
        const order = req.body;

        if (!order || !order.id) {
            return res.status(400).json({ error: 'Invalid order data' });
        }

        const result = await orderService.processOrder(order);

        res.status(201).json(result);
    }),

    getProcessedOrders: asyncHandler(async (req, res) => {
        const orders = await orderService.getProcessedOrders();

        res.json({
            total: orders.length,
            orders
        });
    }),

    getProcessedOrderById: asyncHandler(async (req, res) => {
        const order = await orderService.getProcessedOrderById(req.params.id);

        if (!order) {
            return res.status(404).json({ error: 'Envio não encontrado' });
        }

        res.json(order);
    })
};