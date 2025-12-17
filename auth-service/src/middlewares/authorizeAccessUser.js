// src/middlewares/authorizeAccessUser.js
import jwt from 'jsonwebtoken';
import logger from '../config/auth.logger.js';
import config from '../config/auth.config.js';

export const authorizeAccessUser = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'Missing Authorization header' });

  // Aceita "Bearer <token>" ou apenas "<token>"
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : header.trim();

  if (!token) {
    return res.status(401).json({ message: 'Authorization token missing or empty' });
  }

  const userSecret = config.jwt?.secret ?? config.JWT_SECRET ?? config.secret;

  if (!userSecret) {
    logger.error('JWT secret not configured');
    return res.status(500).json({ message: 'Server configuration error' });
  }

  try {
    const payload = jwt.verify(token, userSecret);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};
