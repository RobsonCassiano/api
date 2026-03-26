/**
 * Extrair numero de rastreamento da resposta FedEx
 */
function extractTracking(response) {
    return (
        response?.trackingNumber ||
        response?.shipmentInfo?.masterTrackingNumber ||
        response?.fullResponse?.output?.transactionShipments?.[0]?.masterTrackingNumber ||
        response?.output?.transactionShipments?.[0]?.masterTrackingNumber ||
        null
    );
}

module.exports = {
    extractTracking
};
