/**
 * Wrapper para funções async em controllers
 * Captura erros automaticamente sem precisar de try/catch em cada um
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
