// src/middlewares/authorizeAccessUser.js
import jwt from 'jsonwebtoken';
import logger from '../config/bank.logger.js';
import config from '../config/bank.config.js';

export const authorizeAccessUser = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'Missing Authorization header' });

  // Aceita "Bearer <token>" ou apenas "<token>"
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();

  if (!token) {
    return res.status(401).json({ message: 'Authorization token missing or empty' });
  }

  const secret = config.jwt?.secret;
  if (!secret) {
    const message = 'JWT secret not configured';
    logger.error(message);
    throw new Error(message);
  }

  try {
    const payload = jwt.verify(token, secret);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};
