/* === D:\SmartIASystems\product-service\src\middlewares\authorizeAccessAdmin.js === */
// src/middlewares/authorizeAccessAdmin.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';
import config from '../config/config.js';

function urlJoin(base, p) {
  const b = base.endsWith('/') ? base : base + '/';
  const path = p.startsWith('/') ? p.slice(1) : p;
  return new URL(path, b).toString().replace(/\/+$/, '');
}

export const authorizeAccessAdmin = async (req, res, next) => {
  const base = String(config.services.authBaseUrl || config.authServiceUrl || '').trim();
  if (!base) {
    logger.error('JWT_SERVICE_URL não configurado');
    return res.status(500).json({ message: 'Configuração do serviço de autenticação ausente' });
  }

  const rawAuth = req.headers.authorization;
  if (!rawAuth) return res.status(401).json({ message: 'Missing Authorization header' });
  const token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : rawAuth.trim();

  // curto-circuito por claim
  if (req.user?.isAdmin === true || req.user?.groupName === 'admin') {
    req.access = { ...(req.access || {}), isAdmin: true };
    return next();
  }

  if (!req.user?.group) return res.status(401).json({ message: 'Grupo do usuário ausente' });

  try {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !(config.env === 'development' || config.skipTlsVerify),
    });

    const url = urlJoin(base, `groups/${encodeURIComponent(req.user.group)}`);
    const { data: group } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      timeout: 7000,
    });

    if (!group || group.name !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores' });
    }

    req.access = { ...(req.access || {}), isAdmin: true };
    return next();
  } catch (error) {
    if (error?.response && [401, 403].includes(error.response.status)) {
      return res.status(403).json({ message: 'Não autorizado' });
    }
    logger.error('Erro ao verificar grupo do usuário', { err: error?.message });
    return res.status(502).json({ message: 'Auth-service indisponível' });
  }
};
