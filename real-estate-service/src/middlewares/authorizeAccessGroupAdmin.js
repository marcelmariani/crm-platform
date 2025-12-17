// src/middlewares/authorizeAccessGroupAdmin.js
import axios from 'axios';
import https from 'https';

const baseURL = (() => {
  const b = String(process.env.JWT_SERVICE_URL || '').replace(/\/+$/, '');
  return /\/v1$/.test(b) ? b : `${b}/v1`;
})();

const httpsAgent =
  process.env.SKIP_TLS_VERIFY === 'true'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

/**
 * Marca req.access.isAdmin = true se o grupo do usuário for "admin".
 * Não bloqueia fluxo em caso de erro. Requer authorizeAccessUser antes.
 */
export default async function authorizeAccessGroupAdmin(req, _res, next) {
  try {
    const groupId = req.user?.group;
    if (!groupId) return next();

    const bearer = req.headers.authorization || '';
    const headers = bearer ? { Authorization: bearer } : undefined;

    const { data } = await axios.get(`${baseURL}/groups/${groupId}`, {
      headers,
      httpsAgent,
      timeout: 8000,
    });

    const name =
      data?.group?.name ??
      data?.name ??
      data?.Group?.name ??
      '';

    if (String(name).toLowerCase() === 'admin') {
      req.access = { ...(req.access || {}), isAdmin: true };
    }
  } catch {
    // silencioso
  }
  return next();
}
