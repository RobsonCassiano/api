/**
 * Logger utilitario padronizado para evitar problemas de encoding no terminal.
 */
function formatData(data) {
    if (data === '' || data === undefined) {
        return '';
    }

    return typeof data === 'string' ? data : JSON.stringify(data);
}

function write(method, level, message, data = '') {
    const suffix = formatData(data);
    method(suffix ? `[${level}] ${message} ${suffix}` : `[${level}] ${message}`);
}

const logger = {
    info: (msg, data = '') => write(console.log, 'INFO', msg, data),
    success: (msg, data = '') => write(console.log, 'SUCCESS', msg, data),
    error: (msg, data = '') => write(console.error, 'ERROR', msg, data),
    warn: (msg, data = '') => write(console.warn, 'WARN', msg, data),
    debug: (msg, data = '') => write(console.log, 'DEBUG', msg, data)
};

module.exports = logger;
