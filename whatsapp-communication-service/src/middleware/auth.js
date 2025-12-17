import jwt from "jsonwebtoken";
import logger from "../config/logger.js";  

export function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    logger.warn('Token não fornecido');
    return res.status(401).json({ error: 'Token não fornecido' });
  }
  
  const token = authHeader.replace(/^Bearer\s+/i, '');

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    logger.error(`Token inválido: ${err.message}`);
    res.status(401).json({ error: 'Token inválido' });
  }
}
