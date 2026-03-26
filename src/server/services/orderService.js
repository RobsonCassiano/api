const fs = require('fs').promises;
const path = require('path');

const fedexService = require('./fedexService');
const shopifyService = require('./shopifyService');
const { extractTracking } = require('../utils/helpers');
const logger = require('../utils/logger');

const ORDERS_FILE = path.join(__dirname, '../../processed-orders.json');

function buildFedexPayloadFromOrder(order) {
    const shipping = order.payload?.order?.shippingAddress || order.shippingAddress;
    const items = order.payload?.order?.items || order.items || [];
    const currency = order.currency || order.payload?.order?.currency || 'USD';

    if (!shipping) {
        throw new Error('Endereco de entrega nao encontrado no pedido');
    }

    return {
        shipper: {
            contact: {
                personName: process.env.FEDEX_SHIPPER_CONTACT_NAME || 'Warehouse Team',
                companyName: process.env.FEDEX_SHIPPER_COMPANY_NAME || 'FedEx PSDU App',
                phoneNumber: process.env.FEDEX_SHIPPER_PHONE,
                emailAddress: process.env.FEDEX_SHIPPER_EMAIL
            },
            address: {
                streetLines: [
                    process.env.FEDEX_SHIPPER_ADDRESS_LINE1,
                    process.env.FEDEX_SHIPPER_ADDRESS_LINE2
                ].filter(Boolean),
                city: process.env.FEDEX_SHIPPER_CITY,
                stateOrProvinceCode: process.env.FEDEX_SHIPPER_STATE,
                postalCode: process.env.FEDEX_SHIPPER_POSTAL_CODE,
                countryCode: process.env.FEDEX_SHIPPER_COUNTRY_CODE || 'BR'
            }
        },
        recipient: {
            contact: {
                personName: `${shipping.firstName || ''} ${shipping.lastName || ''}`.trim() || shipping.name || 'Customer',
                companyName: shipping.company || shipping.name || 'Customer',
                phoneNumber: shipping.phone,
                emailAddress: order.email || order.payload?.order?.email
            },
            address: {
                streetLines: [shipping.address1, shipping.address2].filter(Boolean),
                city: shipping.city,
                stateOrProvinceCode: shipping.state?.code || shipping.province_code,
                postalCode: shipping.postalCode || shipping.zip,
                countryCode: shipping.countryCode || shipping.country_code || 'US'
            }
        },
        packages: [
            {
                weight: items.reduce((sum, item) => sum + ((parseFloat(item.weight) || 1) * (parseInt(item.quantity, 10) || 1)), 0) || 1,
                weightUnit: 'KG',
                length: 20,
                width: 20,
                height: 20,
                dimensionUnit: 'CM'
            }
        ],
        items: items.map((item) => ({
            description: item.name || item.title || 'Item',
            originCountry: item.originCountry || 'US',
            quantity: parseInt(item.quantity, 10) || 1,
            unitPrice: parseFloat(item.price) || 0,
            totalPrice: (parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 1),
            weight: parseFloat(item.weight) || 1,
            weightUnit: 'KG',
            currency
        })),
        totalValue: items.reduce((sum, item) => sum + ((parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 1)), 0),
        currency,
        serviceType: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
        shipDatestamp: new Date().toISOString().split('T')[0]
    };
}

function validateOrderShipmentData(payload) {
    const missing = [];
    const shipperAddress = payload.shipper?.address || {};

    if (!shipperAddress.streetLines?.length) missing.push('FEDEX_SHIPPER_ADDRESS_LINE1');
    if (!shipperAddress.city) missing.push('FEDEX_SHIPPER_CITY');
    if (!shipperAddress.stateOrProvinceCode) missing.push('FEDEX_SHIPPER_STATE');
    if (!shipperAddress.postalCode) missing.push('FEDEX_SHIPPER_POSTAL_CODE');
    if (!payload.recipient?.address?.streetLines?.length) missing.push('recipient.address1');
    if (!payload.items.length) missing.push('order.items');

    if (missing.length) {
        throw new Error(`Dados insuficientes para processar pedido: ${missing.join(', ')}`);
    }
}

async function loadProcessedOrders() {
    try {
        const data = await fs.readFile(ORDERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveProcessedOrder(orderData) {
    const orders = await loadProcessedOrders();
    const newOrder = {
        id: Date.now(),
        ...orderData,
        processedAt: new Date().toISOString()
    };

    orders.push(newOrder);
    await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2));

    return newOrder;
}

async function retry(fn, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === attempts - 1) {
                throw error;
            }

            logger.warn(`Retry ${i + 1}`);
        }
    }
}

module.exports = {
    async processOrder(order) {
        const orderId = order.id || order.payload?.order?.id;
        logger.info('Processando pedido', { orderId });

        const existing = (await loadProcessedOrders())
            .find((item) => item.orderId === orderId);

        if (existing) {
            logger.warn('Pedido ja processado', { orderId });
            return existing;
        }

        try {
            const payload = buildFedexPayloadFromOrder(order);
            validateOrderShipmentData(payload);

            const shipment = await retry(() =>
                fedexService.createShipment(payload)
            );

            const trackingNumber = extractTracking(shipment);

            if (!trackingNumber) {
                throw new Error('Tracking nao encontrado');
            }

            await retry(() =>
                shopifyService.fulfillOrder(order, trackingNumber)
            );

            const saved = await saveProcessedOrder({
                orderId,
                trackingNumber,
                status: 'processed'
            });

            logger.success('Pedido processado', {
                orderId,
                trackingNumber
            });

            return {
                success: true,
                trackingNumber,
                processedOrderId: saved.id
            };
        } catch (error) {
            logger.error('Erro no processamento', {
                orderId,
                message: error.message,
                stack: error.stack
            });
            throw error;
        }
    },

    async getProcessedOrders() {
        return loadProcessedOrders();
    },

    async getProcessedOrderById(id) {
        const orders = await loadProcessedOrders();
        return orders.find((item) => item.id == id);
    }
};
