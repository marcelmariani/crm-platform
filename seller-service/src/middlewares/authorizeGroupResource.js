import axios from 'axios';
import https from 'https';
import config from '../config/config.js';
import logger from '../config/logger.js';
import { PERM, SCOPE } from '../middlewares/authorizeGroupResourceGrant.js';

// junta base e path sem perder /v1
function urlJoin(base, path) {
  const b = base.endsWith('/') ? base : `${base}/`;
  const p = path.startsWith('/') ? path.slice(1) : path;
  return new URL(p, b).toString().replace(/\/+$/, '');
}

export function authorizeGroupResource(resourceName, requiredPerm) {
  if (!resourceName) throw new Error('resourceName é obrigatório');
  if (typeof requiredPerm !== 'number') throw new Error('requiredPerm deve ser number (bitmask)');

  return async function authorizeGroupResourceMiddleware(req, res, next) {
    try {
      const user = req.user || {};
      if (!user.group) return res.status(401).json({ message: 'JWT sem group' });

      // curto-circuito para admin via claim
      if (user.isAdmin === true || user.groupName === 'admin') {
        req.access = { ...(req.access || {}), isAdmin: true };
        req.grant = {
          groupId: user.group,
          groupName: user.groupName || 'admin',
          resource: resourceName,
          perms: PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE,
          scope: SCOPE.ALL,
          isAdmin: true,
        };
        return next();
      }

      const base = String(config.services.authBaseUrl || '').trim();
      if (!base) return res.status(403).json({ message: 'Autorização indisponível' });

      const httpsAgent = new https.Agent({
        rejectUnauthorized: !(config.env === 'development' || config.skipTlsVerify),
      });
      const headers = req.headers.authorization ? { Authorization: req.headers.authorization } : {};

      const url = urlJoin(base, config.services.authGrantsCheckPath || 'grants/effective');
      const groupKey = config.services.authGrantsQueryGroupKey || 'groupId';
      const resourceKey = config.services.authGrantsQueryResourceKey || 'resourceName';

      const groupId = String(user.group);
      const resName = String(resourceName || config.appResourceName);

      const method = (config.services.authGrantsCheckMethod || 'GET').toUpperCase();
      const axiosCfg = { headers, httpsAgent, timeout: 7000 };

      // log de diagnóstico sem token
      //logger.debug('authz.check', { url, method, groupId, resourceName: resName });

      let grantResp;
      if (method === 'POST') {
        const body = { [groupKey]: groupId, [resourceKey]: resName };
        grantResp = await axios.post(url, body, axiosCfg);
      } else {
        const qs = new URLSearchParams({ [groupKey]: groupId, [resourceKey]: resName }).toString();
        grantResp = await axios.get(`${url}?${qs}`, axiosCfg);
      }

      const grant = grantResp?.data || {};
      const perms = Number(grant.perms ?? grant.permissions ?? 0);
      const scope = String(grant.scope || 'own');
      const groupName = grant.groupName || grant.group?.name;

      if (!perms) return res.status(403).json({ message: 'Permissões não encontradas' });

      const hasPerm = (perms & requiredPerm) === requiredPerm;
      if (!hasPerm) return res.status(403).json({ message: 'Não autorizado' });

      const fullMask = PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE;
      const isAdmin =
        grant.isAdmin === true ||
        groupName === 'admin' ||
        (scope === 'all' && (perms & fullMask) === fullMask);

      req.access = { ...(req.access || {}), isAdmin };
      req.grant = { ...grant, perms, scope, groupName, isAdmin };
      return next();
    } catch (err) {
      logger.error('Falha em authorizeGroupResource', { err: err?.message });
      const body = { message: 'Auth-service indisponível' };
      if (config.env !== 'production') {
        // inclui o resource efetivo para depuração
        body.detail = err?.response?.data || err?.message || 'unknown';
      }
      return res.status(502).json(body);
    }
  };
}

export { PERM } from '../middlewares/authorizeGroupResourceGrant.js';
