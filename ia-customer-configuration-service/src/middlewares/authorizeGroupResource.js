// src/middlewares/authorizeGroupResource.js
import axios from 'axios';
import https from 'https';
import { PERM } from '../models/GroupResourceGrant.js';

/**
 * Middleware factory that verifies if the authenticated user's group
 * has the required permission for a given resource.
 *
 * It expects that `authorizeAccessUser` has already populated `req.user`
 * with the decoded JWT payload containing the `group` field.
 *
 * @param {string} resourceName - Name of the resource to check.
 * @param {number} requiredPerm - Bitmask of the required permission (use PERM constants).
 * @returns Express middleware function.
 */

export function authorizeGroupResource(resourceName, requiredPerm) {
  return async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ message: 'Token ausente' });

      const base = (process.env.JWT_SERVICE_URL || '').replace(/\/+$/, '');
      const url = new URL(
        `grants/effective?groupId=${encodeURIComponent(
          req.user.group
        )}&resourceName=${encodeURIComponent(resourceName)}`,
        base + '/'
      ).toString();

      const skipTls =
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'staging' ||
        String(process.env.SKIP_TLS_VERIFY).toLowerCase() === 'true';

      const agent = new https.Agent({ rejectUnauthorized: !skipTls });

      const { data: grant } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent: agent,
        timeout: 7000,
      });

      if (!grant || typeof grant.perms !== 'number')
        return res.status(403).json({ message: 'Grant inválido' });

      if ((grant.perms & requiredPerm) !== requiredPerm)
        return res.status(403).json({ message: 'Não autorizado' });

      const full = PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE;
      const isAdmin =
        grant.isAdmin === true ||
        grant.groupName === 'admin' ||
        grant.scope === 'all' ||
        ((grant.perms & full) === full && grant.scope === 'all');

      req.access = { ...(req.access || {}), isAdmin };
      req.grant = grant;
      return next();
    } catch (err) {
      const status = err?.response?.status || 502;
      const detail = err?.response?.data?.message || err?.code || 'ERR';
      return res
        .status(502)
        .json({ message: 'Auth-service indisponível', detail, status });
    }
  };
}

export { PERM } from '../models/GroupResourceGrant.js';
