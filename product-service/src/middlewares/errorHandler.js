/* === D:\SmartIASystems\product-service\src\middlewares\errorHandler.js === */
// src/middlewares/errorHandler.js
export function notFound(_req, res) {
  res.status(404).json({ message: 'Resource not found' });
}

export function errorHandler(err, _req, res, _next) {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'JSON inválido', detail: err.message });
  }
  if (err && err.code === 11000) {
    return res.status(409).json({ message: 'Duplicate key', detail: err.keyValue || null });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id', detail: err.message });
  }
  if (typeof err?.message === 'string' && /Invalid status transition/i.test(err.message)) {
    return res.status(422).json({
      message: 'Operação não permitida para o estado atual do produto',
      detail: err.message,
    });
  }
  if (typeof err?.message === 'string' && /Invalid status "/i.test(err.message)) {
    return res.status(422).json({ message: 'Status inválido', detail: err.message });
  }

  const status = err?.status || (err?.name === 'ValidationError' ? 422 : 500);
  return res.status(status).json({ message: err?.message || 'Internal error' });
}
