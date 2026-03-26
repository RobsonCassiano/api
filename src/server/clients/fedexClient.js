require('dotenv').config();
const axios = require('axios');
const logger = require('../utils/logger');

const FEDEX_BASE_URL = process.env.FEDEX_BASE_URL || 'https://apis.fedex.com';
const tokenCache = new Map();

function resolveCredentials(credentials = {}) {
    const apiKey = String(credentials.apiKey || process.env.FEDEX_API_KEY || '').trim();
    const secretKey = String(credentials.secretKey || process.env.FEDEX_SECRET_KEY || '').trim();
    const baseURL = String(credentials.baseURL || FEDEX_BASE_URL).trim();

    if (!apiKey || !secretKey) {
        throw new Error('Credenciais FedEx nao configuradas. Informe apiKey e secretKey do usuario ou defina FEDEX_API_KEY e FEDEX_SECRET_KEY no ambiente.');
    }

    return {
        apiKey,
        secretKey,
        baseURL
    };
}

function getCacheKey(credentials) {
    return `${credentials.baseURL}::${credentials.apiKey}::${credentials.secretKey}`;
}

function getTokenEntry(credentials) {
    const cacheKey = getCacheKey(credentials);

    if (!tokenCache.has(cacheKey)) {
        tokenCache.set(cacheKey, {
            token: null,
            expiresAt: null,
            promise: null
        });
    }

    return tokenCache.get(cacheKey);
}

function hasValidCachedToken(entry) {
    return Boolean(entry.token && entry.expiresAt && new Date() < entry.expiresAt);
}

async function generateToken(credentials = {}) {
    try {
        const resolvedCredentials = resolveCredentials(credentials);
        const entry = getTokenEntry(resolvedCredentials);
        logger.info('Gerando novo token FedEx');

        const response = await axios.post(`${resolvedCredentials.baseURL}/oauth/token`, new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: resolvedCredentials.apiKey,
            client_secret: resolvedCredentials.secretKey
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000
        });

        const token = response.data.access_token;
        const expiresIn = response.data.expires_in;

        entry.token = token;
        entry.expiresAt = new Date(Date.now() + Math.max(expiresIn - 60, 0) * 1000);

        logger.success('Token FedEx gerado com sucesso', {
            expiresAt: entry.expiresAt.toISOString()
        });

        return token;
    } catch (error) {
        logger.error('Erro ao gerar token FedEx', {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
        });
        throw new Error(`Falha de autenticacao FedEx: ${error.response?.data?.error_description || error.message}`);
    }
}

async function getAuthToken(credentials = {}) {
    const resolvedCredentials = resolveCredentials(credentials);
    const entry = getTokenEntry(resolvedCredentials);

    if (hasValidCachedToken(entry)) {
        return entry.token;
    }

    if (entry.promise) {
        return entry.promise;
    }

    entry.promise = generateToken(resolvedCredentials);

    try {
        return await entry.promise;
    } finally {
        entry.promise = null;
    }
}

async function request(method, pathname, payload, credentials = {}) {
    const resolvedCredentials = resolveCredentials(credentials);
    const token = await getAuthToken(resolvedCredentials);

    try {
        return await axios({
            method,
            url: `${resolvedCredentials.baseURL}${pathname}`,
            data: payload,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            }
        });
    } catch (error) {
        if (error.response?.status !== 401) {
            throw error;
        }

        logger.warn('Token FedEx expirado, tentando renovar');
        clearTokenCache(resolvedCredentials);
        const retryToken = await getAuthToken(resolvedCredentials);

        return axios({
            method,
            url: `${resolvedCredentials.baseURL}${pathname}`,
            data: payload,
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${retryToken}`
            }
        });
    }
}

function clearTokenCache(credentials = null) {
    if (credentials) {
        const resolvedCredentials = resolveCredentials(credentials);
        tokenCache.delete(getCacheKey(resolvedCredentials));
        logger.info('Cache de token FedEx limpo para um conjunto de credenciais');
        return;
    }

    tokenCache.clear();
    logger.info('Cache de token FedEx limpo');
}

function getTokenCacheStatus() {
    const entries = Array.from(tokenCache.values());

    return {
        cacheEntries: entries.length,
        hasToken: entries.some((entry) => !!entry.token),
        expiresAt: entries[0]?.expiresAt?.toISOString() || null,
        isValid: entries.some((entry) => hasValidCachedToken(entry))
    };
}

module.exports = {
    post(pathname, payload, credentials = {}) {
        return request('post', pathname, payload, credentials);
    },
    put(pathname, payload, credentials = {}) {
        return request('put', pathname, payload, credentials);
    },
    getAuthToken,
    clearTokenCache,
    getTokenCacheStatus
};
