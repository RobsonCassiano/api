const shopifyClient = require('../clients/shopifyClient');

function sanitizeOrderUpdates(updates = {}) {
    const allowedFields = [
        'email',
        'note',
        'tags',
        'metafields',
        'shipping_address',
        'billing_address'
    ];

    return allowedFields.reduce((acc, field) => {
        if (updates[field] !== undefined) {
            acc[field] = updates[field];
        }

        return acc;
    }, {});
}

async function createCaptureTransaction(orderId, payload) {
    const response = await shopifyClient.post(`/orders/${orderId}/transactions.json`, {
        transaction: payload
    });

    return response.data.transaction;
}

module.exports = {
    /**
     * Obter lista de pedidos do Shopify
     */
    async getOrders(status = 'any') {
        try {
            const response = await shopifyClient.get('/orders.json', {
                params: { status, limit: 50 }
            });
            return response.data.orders;
        } catch (error) {
            throw new Error(`Erro ao buscar pedidos: ${error.message}`);
        }
    },

    /**
     * Obter detalhes de um pedido específico
     */
    async getOrderById(orderId) {
        try {
            const response = await shopifyClient.get(`/orders/${orderId}.json`);
            return response.data.order;
        } catch (error) {
            throw new Error(`Erro ao buscar pedido: ${error.message}`);
        }
    },

    /**
     * Atualizar campos suportados do pedido
     */
    async updateOrder(orderId, updates = {}) {
        try {
            const sanitizedUpdates = sanitizeOrderUpdates(updates);

            if (!Object.keys(sanitizedUpdates).length) {
                throw new Error('Nenhum campo valido foi informado para atualizacao');
            }

            const response = await shopifyClient.put(`/orders/${orderId}.json`, {
                order: {
                    id: orderId,
                    ...sanitizedUpdates
                }
            });

            return response.data.order;
        } catch (error) {
            throw new Error(`Erro ao atualizar pedido: ${error.message}`);
        }
    },

    /**
     * Criar fulfillment para um pedido
     */
    async createFulfillment(orderId, lineItems) {
        try {
            const response = await shopifyClient.post(`/orders/${orderId}/fulfillments.json`, {
                fulfillment: { line_items_by_fulfillment_orders: lineItems }
            });
            return response.data.fulfillment;
        } catch (error) {
            throw new Error(`Erro ao criar fulfillment: ${error.message}`);
        }
    },

    /**
     * Atualizar fulfillment com tracking number (FedEx)
     */
    async fulfillOrder(order, trackingNumber) {
        try {
            // Extrair IDs do pedido
            const orderId = order.id || order.payload?.order?.id;
            const fulfillmentOrderId = order.payload?.order?.packages?.[0]?.fulfillmentOrderId;

            if (!orderId || !fulfillmentOrderId) {
                throw new Error('Order ID ou Fulfillment Order ID não encontrados');
            }

            console.log(`📦 Atualizando fulfillment - Order: ${orderId}, Tracking: ${trackingNumber}`);

            // Atualizar fulfillment com tracking
            const response = await shopifyClient.post(
                `/fulfillment_orders/${fulfillmentOrderId}/fulfillments.json`,
                {
                    fulfillment: {
                        tracking_info: {
                            number: trackingNumber,
                            company: "fedex",
                            url: `https://tracking.fedex.com/en-us/tracking/${trackingNumber}`
                        },
                        notify_customer: true
                    }
                }
            );

            console.log('✅ Fulfillment atualizado com sucesso');
            return response.data.fulfillment;
        } catch (error) {
            throw new Error(`Erro ao atualizar fulfillment: ${error.message}`);
        }
    },

    /**
     * Fechar pedido
     */
    async closeOrder(orderId) {
        try {
            const response = await shopifyClient.post(`/orders/${orderId}/close.json`);
            return response.data.order;
        } catch (error) {
            throw new Error(`Erro ao fechar pedido: ${error.message}`);
        }
    },

    /**
     * Reabrir pedido fechado
     */
    async openOrder(orderId) {
        try {
            const response = await shopifyClient.post(`/orders/${orderId}/open.json`);
            return response.data.order;
        } catch (error) {
            throw new Error(`Erro ao reabrir pedido: ${error.message}`);
        }
    },

    /**
     * Cancelar pedido
     */
    async cancelOrder(orderId, options = {}) {
        try {
            const payload = {};

            if (options.amount !== undefined) payload.amount = options.amount;
            if (options.currency !== undefined) payload.currency = options.currency;
            if (options.reason !== undefined) payload.reason = options.reason;
            if (options.email !== undefined) payload.email = options.email;
            if (options.refund !== undefined) payload.refund = options.refund;
            if (options.restock !== undefined) payload.restock = options.restock;

            const response = await shopifyClient.post(`/orders/${orderId}/cancel.json`, payload);
            return response.data.order;
        } catch (error) {
            throw new Error(`Erro ao cancelar pedido: ${error.message}`);
        }
    },

    /**
     * Listar transacoes do pedido
     */
    async getOrderTransactions(orderId) {
        try {
            const response = await shopifyClient.get(`/orders/${orderId}/transactions.json`);
            return response.data.transactions || [];
        } catch (error) {
            throw new Error(`Erro ao buscar transacoes do pedido: ${error.message}`);
        }
    },

    /**
     * Capturar pagamento autorizado e marcar pedido como pago
     */
    async markOrderAsPaid(orderId, options = {}) {
        try {
            const order = await this.getOrderById(orderId);
            const transactions = await this.getOrderTransactions(orderId);
            const currency = options.currency || order.currency;
            const childTransactions = new Map();

            for (const transaction of transactions) {
                if (!transaction.parent_id) {
                    continue;
                }

                if (!childTransactions.has(transaction.parent_id)) {
                    childTransactions.set(transaction.parent_id, []);
                }

                childTransactions.get(transaction.parent_id).push(transaction);
            }

            const authorizationTransactions = transactions.filter((transaction) =>
                transaction.kind === 'authorization' &&
                transaction.status === 'success'
            );

            if (!authorizationTransactions.length) {
                throw new Error('Nenhuma transacao de autorizacao disponivel para captura');
            }

            let remainingAmount = options.amount !== undefined
                ? Number(options.amount)
                : authorizationTransactions.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);

            if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) {
                throw new Error('Valor para captura invalido');
            }

            const captures = [];

            for (const authorization of authorizationTransactions) {
                if (remainingAmount <= 0) {
                    break;
                }

                const children = childTransactions.get(authorization.id) || [];
                const alreadyCaptured = children
                    .filter((transaction) => transaction.kind === 'capture' && transaction.status === 'success')
                    .reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
                const isVoided = children.some((transaction) =>
                    transaction.kind === 'void' && transaction.status === 'success'
                );

                if (isVoided) {
                    continue;
                }

                const capturableAmount = Number(authorization.amount || 0) - alreadyCaptured;

                if (capturableAmount <= 0) {
                    continue;
                }

                const amountToCapture = Math.min(capturableAmount, remainingAmount);

                const transaction = await createCaptureTransaction(orderId, {
                    kind: 'capture',
                    parent_id: authorization.id,
                    amount: amountToCapture.toFixed(2),
                    currency
                });

                captures.push(transaction);
                remainingAmount -= amountToCapture;
            }

            if (!captures.length) {
                throw new Error('Nenhuma captura foi criada; verifique se a autorizacao ainda esta em aberto');
            }

            if (remainingAmount > 0) {
                throw new Error('Nao foi possivel capturar o valor solicitado integralmente');
            }

            return {
                orderId,
                currency,
                captures
            };
        } catch (error) {
            throw new Error(`Erro ao marcar pedido como pago: ${error.message}`);
        }
    }
};
