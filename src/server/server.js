require('dotenv').config();
const express = require('express');
const cors = require('cors');

const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const logger = require('./utils/logger');

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  console.warn('NODE_TLS_REJECT_UNAUTHORIZED=0 foi removido para manter a verificacao TLS ativa.');
}

const app = express();
const PORT = process.env.PORT || 3000;

// ========== MIDDLEWARES ==========
app.use(express.json());

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*'
}));

// Log de requisições
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'fedex-shipping-api',
    status: 'online',
    health: '/health',
    apiBase: '/api/v1'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ========== ROTAS ==========
app.use('/', routes);

// ========== ERROR HANDLER ==========
app.use(errorHandler);

// ========== PROCESS ERRORS ==========
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection', err);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', err);
});

// ========== START ==========
const server = app.listen(PORT, () => {
  logger.success(`✅ HTTP Server running on http://localhost:${PORT}`);
});

server.setTimeout(15000);
