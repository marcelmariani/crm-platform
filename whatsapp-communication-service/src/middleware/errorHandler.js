import logger from "../config/logger.js";

export function errorHandler(err, req, res, next) {
  logger.error(err.stack || err.message || err);

  const status = err.statusCode || err.status || 500;
  res.status(status).json({
    error: err.message || "Internal Server Error"
  });
}
