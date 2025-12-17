// src/middlewares/authorizeAccessAdmin.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';
import config from '../config/config.js';

// junta base e path sem perder o /v1 da base
function urlJoin(base, path) {
  const b = base.endsWith('/') ? base : `${base}/`;
  const p = path.startsWith('/') ? path.slice(1) : path;
  return new URL(p, b).toString().replace(/\/+$/, '');
}

export const authorizeAccessAdmin = async (req, res, next) => {
  const base = String(config.services?.authBaseUrl || '').trim();
  if (!base) {
    logger.error('JWT_SERVICE_URL não configurado');
    return res.status(500).json({ message: 'Configuração do serviço de autenticação ausente' });
  }

  const rawAuth = req.headers.authorization;
  if (!rawAuth) return res.status(401).json({ message: 'Missing Authorization header' });
  const token = rawAuth.startsWith('Bearer ') ? rawAuth.slice(7).trim() : rawAuth.trim();

  if (!req.user || !req.user.group) {
    return res.status(401).json({ message: 'JWT sem group' });
  }

  try {
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !(config.env === 'development' || config.skipTlsVerify),
    });

    const url = urlJoin(base, `/groups/${req.user.group}`);
    const resp = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent,
      timeout: 7000,
    });

    const group = resp.data;
    if (!group || group.name !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores' });
    }

    req.access = { ...(req.access || {}), isAdmin: true };
    return next();
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401 || status === 403) {
      return res.status(403).json({ message: 'Não autorizado' });
    }
    logger.error('Erro ao verificar grupo do usuário', { err: err?.message });
    const body = { message: 'Auth-service indisponível' };
    if (config.env !== 'production') body.detail = err?.response?.data || err?.message;
    return res.status(502).json(body);
  }
};
export default authorizeAccessAdmin;
