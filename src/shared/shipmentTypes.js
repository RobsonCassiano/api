/**
 * Tipos e contratos compartilhados entre Extension e Server
 */

module.exports = {
    /**
     * Preferencias de impressao por usuario
     */
    PrintPreference: {
        userId: String,
        labelFormat: String,
        autoOpenDocuments: Boolean,
        additionalDocsFormat: String
    },

    /**
     * Estrutura de um pedido de envio
     */
    ShipmentOrder: {
        id: String,
        orderId: String,
        payload: Object,
        shippingAddress: Object,
        items: Array,
        destinationCountry: String,
        totalValue: Number,
        totalItems: Number
    },

    /**
     * Estrutura de resposta de processamento
     */
    ProcessResponse: {
        success: Boolean,
        trackingNumber: String,
        processedOrderId: Number,
        error: String
    },

    /**
     * Estrutura de um envio processado
     */
    ProcessedOrder: {
        id: Number,
        orderId: String,
        trackingNumber: String,
        destinationCountry: String,
        status: String,
        shipmentId: String,
        totalItems: Number,
        processedAt: String
    }
};
