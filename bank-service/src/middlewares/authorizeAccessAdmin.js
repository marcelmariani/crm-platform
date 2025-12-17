import axios from 'axios';
import https from 'https';
import logger from '../config/bank.logger.js';
import config from '../config/bank.config.js';

export const authorizeAccessAdmin = async (req, res, next) => {
  const authServiceUrl =
    config.services?.authBaseUrl || process.env.JWT_AUTH_SERVICE_URL || config.authServiceUrl;
  if (!authServiceUrl) {
    logger.error('JWT_AUTH_SERVICE_URL não configurado');
    return res
      .status(500)
      .json({ message: 'Configuração do serviço de autenticação ausente' });
  }

  const rawAuth = req.headers.authorization;
  if (!rawAuth) return res.status(401).json({ message: 'Missing Authorization header' });
  const token = rawAuth.startsWith('Bearer ')
    ? rawAuth.slice(7).trim()
    : rawAuth.trim();

  if (!req.user || !req.user.group)
    return res.status(401).json({ message: 'Grupo do usuário ausente' });

  try {
    const skipTls =
      config.env === 'development' ||
      config.env === 'staging' ||
      String(process.env.SKIP_TLS_VERIFY).toLowerCase() === 'true';

    const agent = new https.Agent({ rejectUnauthorized: !skipTls });

    const url = `${authServiceUrl.replace(/\/+$/, '')}/groups/${encodeURIComponent(
      req.user.group
    )}`;

    const { data: group } = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      httpsAgent: agent,
      timeout: 5000,
    });

    if (!group || group.name !== 'admin')
      return res.status(403).json({ message: 'Acesso restrito a administradores' });

    req.access = { ...(req.access || {}), isAdmin: true };
    return next();
  } catch (error) {
    if ([401, 403].includes(error?.response?.status))
      return res.status(403).json({ message: 'Não autorizado' });
    logger.error('Erro ao verificar grupo do usuário', error);
    return res.status(500).json({ message: 'Erro interno' });
  }
};
