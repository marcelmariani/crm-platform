// src/middlewares/errorHandler.js
import logger from '../config/customerConfiguration.logger.js';

export class AppError extends Error {
  constructor(code = 'internal_error', status = 400, message = '') {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export function errorHandler(err, req, res, _next) {
  // Mapeia http-errors (err.status), Mongoose, e nosso AppError → status adequado
  const isHttp = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600;
  const isCast = err?.name === 'CastError';
  const isValidation = err?.name === 'ValidationError';
  const isDupKey = err?.code === 11000;
  const isApp = err instanceof AppError;

  const status =
    (isApp && err.status) ||
    (isDupKey ? 409 : 0) ||
    (isValidation || isCast ? 400 : 0) ||
    (isHttp ? err.status : 500);

  const code =
    (isApp && err.code) ||
    (isDupKey ? 'mongo_duplicate_key' : 0) ||
    (isValidation ? 'mongo_validation_error' : 0) ||
    (isCast ? 'mongo_cast_error' : 0) ||
    (isHttp ? 'http_error' : 'internal_error');

  const detail = isDupKey
    ? `O campo ${Object.keys(err?.keyPattern || err?.keyValue || { valor: '' })[0]} já está cadastrado.`
    : (err?.message || code);

  logger.error('request_error', { code, status, detail, path: req.path, method: req.method });
  return res.status(status).json({ error: code, detail });
}
