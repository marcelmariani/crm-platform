// src/middlewares/authorizeGroupResource.js
import axios from 'axios';
import https from 'https';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { PERM, SCOPE } from './authorizeGroupResourceGrant.js';

// Não permitir que a / inicial remova o /v1 da base
function urlJoin(base, path) {
  if (!base) return path;
  const b = String(base).replace(/\/+$/, '');       // remove barras finais
  const p = String(path || '');
  // Se path começa com '/', use origem do base + path absoluto
  try {
    const u = new URL(b);
    if (p.startsWith('/')) return `${u.origin}${p}`;
    // Se base já termina com '/v1' e path começa com 'v1/', evite duplicar
    if (b.endsWith('/v1') && p.startsWith('v1/')) return `${b}/${p.replace(/^v1\//, '')}`;
    return `${b}/${p}`;
  } catch {
    // base não é URL completa; fallback simples
    if (p.startsWith('/')) return p;
    return `${b}/${p}`;
  }
}


const fullMask = PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE;
const methodToPerm = { GET: PERM.READ, POST: PERM.CREATE, PUT: PERM.UPDATE, PATCH: PERM.UPDATE, DELETE: PERM.DELETE };

export function authorizeGroupResource(resourceName, requiredPerm) {
  if (!resourceName) throw new Error('resourceName é obrigatório');
  if (typeof requiredPerm !== 'number') throw new Error('requiredPerm deve ser number (bitmask)');

  return async function authorizeGroupResourceMiddleware(req, res, next) {
    try {
      const user = req.user || {};
      if (!user.group) return res.status(401).json({ message: 'JWT sem group' });

      // Admin curto-circuito
      if (user.isAdmin === true || user.groupName === 'admin') {
        req.access = { ...(req.access || {}), isAdmin: true };
        req.grant = {
          groupId: user.group,
          groupName: user.groupName || 'admin',
          resource: resourceName,
          perms: fullMask,
          scope: SCOPE.ALL,
          isAdmin: true,
        };
        return next();
      }

      const base = String(config.services?.authBaseUrl || '').trim();
      if (!base) return res.status(403).json({ message: 'Autorização indisponível' });

      const httpsAgent = new https.Agent({
        rejectUnauthorized: !(config.env === 'development' || config.skipTlsVerify),
      });

      const headers = {
        ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}),
        Accept: 'application/json',
      };

      // Alinhado ao auth: GET /v1/grants/effective?groupId=&resourceName=
      const url = urlJoin(base, config.services?.authGrantsCheckPath || '/v1/grants/effective');
      const groupKey = config.services?.authGrantsQueryGroupKey || 'groupId';
      const resourceKey = config.services?.authGrantsQueryResourceKey || 'resourceName';

      const groupId = String(user.group);
      const resName = String(resourceName || config.appResourceName);
      const qs = new URLSearchParams({ [groupKey]: groupId, [resourceKey]: resName }).toString();

      /*logger.info({
        msg: 'authorizeGroupResource → calling auth-service',
        url: `${url}?${qs}`
      }); */

      const resp = await axios.get(`${url}?${qs}`, {
        headers,
        httpsAgent,
        timeout: 8000,
        validateStatus: s => s >= 200 && s < 500,
      });

      if (resp.status === 404) {
        logger.error('authorizeGroupResource: endpoint 404', { url });
        return res.status(502).json({ message: 'Auth-service indisponível', detail: 'endpoint 404' });
      }
      if (resp.status >= 400) {
        return res.status(502).json({ message: 'Auth-service indisponível', detail: resp.data });
      }

      // Resposta esperada: { perms, scope, groupName, isAdmin? }
      const data = resp.data || {};
      const perms = Number(data.perms ?? data.permissions ?? 0);
      const scope = String(data.scope || 'own');
      const groupName = data.groupName || user.groupName;
      const isAdmin = data.isAdmin === true || groupName === 'admin' || (scope === 'all' && (perms & fullMask) === fullMask);

      if (!perms) return res.status(403).json({ message: 'Permissões não encontradas' });

      const need = methodToPerm[String(req.method).toUpperCase()] ?? requiredPerm;
      const hasPerm = (perms & need) === need || (perms & requiredPerm) === requiredPerm;
      if (!hasPerm) return res.status(403).json({ message: 'Não autorizado' });

      req.access = { ...(req.access || {}), isAdmin };
      req.grant = { ...data, groupId, resource: resName, perms, scope, groupName, isAdmin };

      return next();
    } catch (err) {
      logger.error('Falha em authorizeGroupResource', { err: err?.message });
      if (config.env !== 'production') {
        return res.status(502).json({ message: 'Auth-service indisponível', detail: err?.response?.data || err?.message });
      }
      return res.status(502).json({ message: 'Auth-service indisponível' });
    }
  };
}

export { PERM } from './authorizeGroupResourceGrant.js';
