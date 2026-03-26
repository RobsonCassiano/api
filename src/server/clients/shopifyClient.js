require('dotenv').config();
const axios = require('axios');

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_PASSWORD = process.env.SHOPIFY_API_PASSWORD;
const SHOPIFY_SHOP_NAME = process.env.SHOPIFY_SHOP_NAME;

// Validação de credenciais
if (!SHOPIFY_API_KEY || !SHOPIFY_API_PASSWORD || !SHOPIFY_SHOP_NAME) {
  console.warn('[⚠️  Shopify Client] Credenciais Shopify não configuradas no .env');
}

const shopifyClient = axios.create({
    baseURL: `https://${SHOPIFY_SHOP_NAME}.myshopify.com/admin/api/2024-01`,
    auth: {
        username: SHOPIFY_API_KEY,
        password: SHOPIFY_API_PASSWORD
    }
});

module.exports = shopifyClient;
