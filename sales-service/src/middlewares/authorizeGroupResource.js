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
    const user = req.user || {};
    
    try {
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

      if (!perms) {
        logger.warn('Permissões não encontradas', { 
          groupId, 
          resourceName: resName,
          grantResponse: grant 
        });
        return res.status(403).json({ message: 'Permissões não encontradas' });
      }

      const hasPerm = (perms & requiredPerm) === requiredPerm;
      if (!hasPerm) {
        logger.warn('Permissão insuficiente', { 
          groupId, 
          resourceName: resName,
          requiredPerm,
          grantedPerms: perms 
        });
        return res.status(403).json({ message: 'Não autorizado' });
      }

      // Valida se é admin consultando o grupo pelo ID
      let isAdmin = grant.isAdmin === true || groupName === 'admin';
      
      // Se ainda não identificou como admin, consulta o grupo pelo ID
      if (!isAdmin) {
        try {
          const groupUrl = urlJoin(base, `/v1/groups/${groupId}`);
          logger.debug('Verificando grupo por ID', { groupId, groupUrl });
          const groupResp = await axios.get(groupUrl, axiosCfg);
          const group = groupResp?.data || {};
          isAdmin = group.name === 'admin';
          logger.info('Grupo verificado', { groupId, groupName: group.name, isAdmin });
        } catch (groupErr) {
          logger.warn('Falha ao verificar grupo por ID', { 
            groupId, 
            error: groupErr?.message,
            status: groupErr?.response?.status 
          });
          // Continua sem isAdmin se a consulta falhar
        }
      }

      const fullMask = PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE;
      if (!isAdmin && scope === 'all' && (perms & fullMask) === fullMask) {
        isAdmin = true;
      }

      req.access = { ...(req.access || {}), isAdmin };
      req.grant = { ...grant, perms, scope, groupName, isAdmin };
      return next();
    } catch (err) {
      const errDetails = {
        message: err?.message,
        code: err?.code,
        status: err?.response?.status,
        statusText: err?.response?.statusText,
        url: err?.config?.url,
        method: err?.config?.method,
        timeout: err?.code === 'ECONNABORTED',
        networkError: err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT',
        authServiceUrl: config.services.authBaseUrl,
        resourceName,
        groupId: user.group
      };

      if (err?.response?.data) {
        errDetails.responseData = err.response.data;
      }

      logger.error('Falha em authorizeGroupResource', errDetails);

      const body = { message: 'Auth-service indisponível' };
      if (config.env !== 'production') {
        body.detail = {
          error: err?.message || 'unknown',
          code: err?.code,
          status: err?.response?.status,
          url: errDetails.url,
          isNetworkError: errDetails.networkError,
          isTimeout: errDetails.timeout,
          responseData: err?.response?.data
        };
      }
      return res.status(502).json(body);
    }
  };
}

export { PERM } from '../middlewares/authorizeGroupResourceGrant.js';
