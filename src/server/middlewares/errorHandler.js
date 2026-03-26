/**
 * Middleware de tratamento de erros global
 */
const errorHandler = (err, req, res, next) => {
    void req;
    void next;

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Erro interno do servidor';

    console.error(`[ERROR] [${statusCode}] ${message}`);

    res.status(statusCode).json({
        error: message,
        status: statusCode,
        timestamp: new Date().toISOString()
    });
};

module.exports = errorHandler;
