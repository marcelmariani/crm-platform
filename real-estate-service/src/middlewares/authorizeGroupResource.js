// src/middlewares/authorizeGroupResource.js
import axios from 'axios';
import https from 'https';

export const PERM = { READ:1<<0, CREATE:1<<1, UPDATE:1<<2, DELETE:1<<3 };

const baseURL = (() => {
  const b = String(process.env.JWT_SERVICE_URL || '').replace(/\/+$/, '');
  return /\/v1$/.test(b) ? b : `${b}/v1`;
})();

const httpsAgent =
  process.env.SKIP_TLS_VERIFY === 'true'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

function numify(v){
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseInt(v,10) || 0;
  if (v && typeof v === 'object') {
    if ('$numberInt' in v) return parseInt(v.$numberInt,10) || 0;
    if ('$numberLong' in v) return parseInt(v.$numberLong,10) || 0;
    if ('value' in v) return numify(v.value);
  }
  return 0;
}

function normalizeGrant(raw, resourceHint){
  if(!raw) return null;
  const resource = String(raw.resource ?? raw.resourceName ?? resourceHint ?? '').toLowerCase();
  const perms = numify(raw.perms ?? raw.permissions ?? raw.permission ?? raw.mask ?? raw.permissionsMask);
  return {
    groupName: raw.groupName ?? raw.group?.name ?? '',
    resource,
    perms,
    scope: raw.scope ?? 'own',
  };
}

function toList(body, resourceHint){
  if (!body) return [];
  if (Array.isArray(body)) return body.map(x => ({ raw:x, hint:resourceHint }));
  if (Array.isArray(body.items)) return body.items.map(x => ({ raw:x, hint:resourceHint }));
  if (body.grant) return [{ raw: body.grant, hint: resourceHint }];
  return [{ raw: body, hint: resourceHint }];
}

async function tryGet(url, opts){
  try { return (await axios.get(url, opts)).data; } catch { return null; }
}

export function authorizeGroupResource(resourceName, requiredPerm){
  const resource = (resourceName || process.env.APP_RESOURCE_NAME || 'real-estate').toLowerCase();

  return async (req, res, next) => {
    try {
      const bearer = req.headers.authorization || '';
      const token = bearer.replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ message: 'Token ausente' });
      if (!req.user?.group) return res.status(401).json({ message: 'Token inválido ou sem grupo' });

      const headers = { Authorization: `Bearer ${token}` };
      const common = { headers, httpsAgent, timeout: 8000 };

      // Admin pelo grupo
      const gdata = await tryGet(`${baseURL}/groups/${req.user.group}`, common);
      if (gdata?.group?.name === 'admin') {
        req.access = { ...(req.access||{}), isAdmin:true };
        req.grant = { groupName:'admin', resource, perms: PERM.READ|PERM.CREATE|PERM.UPDATE|PERM.DELETE, scope:'all' };
        return next();
      }

      const tries = [
        toList(await tryGet(`${baseURL}/grants/effective`, { ...common, params:{ groupId: req.user.group, resourceName: resource } }), resource),
        toList(await tryGet(`${baseURL}/groups/${req.user.group}/grants`, { ...common, params:{ effective:true } }), resource),
      ];

      const normalized = tries.flat().map(({raw, hint}) => normalizeGrant(raw, hint)).filter(Boolean);
      const grant = normalized.find(x => x.resource === resource) || null; // sem fallback para outro recurso

      if (!grant) return res.status(403).json({ message: 'Sem permissão para o recurso' });
      if ((grant.perms & requiredPerm) !== requiredPerm) return res.status(403).json({ message: 'Permissão insuficiente' });

      const full = PERM.READ|PERM.CREATE|PERM.UPDATE|PERM.DELETE;
      const isAdmin = grant.groupName==='admin' || (grant.scope==='all' && (grant.perms & full)===full);
      req.access = { ...(req.access||{}), isAdmin };
      req.grant = grant;
      return next();
    } catch {
      return res.status(502).json({ message: 'Auth-service indisponível' });
    }
  };
}
