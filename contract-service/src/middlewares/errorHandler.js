// src/middlewares/errorHandler.js
import logger from '../config/logger.js';

export class AppError extends Error {
  constructor(code = 'internal_error', status = 400, message = '') {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export function errorHandler(err, req, res, _next) {
  const isCast = err?.name === 'CastError';
  const isValidation = err?.name === 'ValidationError';
  const isApp = err instanceof AppError;

  const status =
    (isApp && err.status) ||
    (isValidation ? 400 : isCast ? 400 : 500);

  const code =
    (isApp && err.code) ||
    (isValidation ? 'mongo_validation_error' : isCast ? 'mongo_cast_error' : 'internal_error');

  const detail = err?.message || code;

  logger.error({ code, status, detail, path: req.path, method: req.method }, 'request_error');

  return res.status(status).json({ error: code, detail });
}
