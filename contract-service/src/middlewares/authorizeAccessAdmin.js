// src/middlewares/authorizeAccessAdmin.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';
import config from '../config/config.js';

export const authorizeAccessAdmin = async (req, res, next) => {
  const authServiceUrl = config.authServiceUrl;
  if (!authServiceUrl) {
    logger.error('JWT_SERVICE_URL não configurado');
    return res.status(500).json({ message: 'Configuração do serviço de autenticação ausente' });
  }

  const rawAuth = req.headers.authorization;
  if (!rawAuth) {
    return res.status(401).json({ message: 'Missing Authorization header' });
  }
  const token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : rawAuth.trim();

  if (!req.user || !req.user.group) {
    return res.status(401).json({ message: 'Grupo do usuário ausente' });
  }

  try {
    // usa NODE_ENV do seu config.js para ignorar TLS em dev
    const isDev = config.env === 'development';
    const agent = new https.Agent({ rejectUnauthorized: !isDev });

    const response = await axios.get(
      `${authServiceUrl}/groups/${req.user.group}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent: agent,
        timeout: 5000,
      }
    );

    const group = response.data;
    if (group.name !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores' });
    }
    if (!req.access) {
      req.access = {};
    }
    req.access.isAdmin = true;

    next();
  } catch (error) {
    if (error.response && [401, 403].includes(error.response.status)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }
    logger.error('Erro ao verificar grupo do usuário', error);
    return res.status(500).json({ message: 'Erro interno' });
  }
};
