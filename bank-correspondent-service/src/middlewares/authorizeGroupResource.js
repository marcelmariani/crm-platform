// src/middlewares/authorizeGroupResource.js
import axios from 'axios';
import https from 'https';
import crypto from 'crypto';
import { PERM } from './GroupResourceGrant.js';

/**
 * Logger helper: tenta req.log (pino/express-pino), depois app logger, cai em console.
 */
function getLogger(req) {
  return req?.log || req?.app?.get?.('logger') || console;
}

/**
 * Middleware que verifica se o grupo do usuário possui permissão no recurso.
 * Adiciona logs com correlação (requestId) e métricas de latência.
 */
export function authorizeGroupResource(resourceName, requiredPerm) {
  return async (req, res, next) => {
    const log = getLogger(req);
    const requestId =
      req.headers['x-request-id'] ||
      req.headers['x-correlation-id'] ||
      crypto.randomUUID();

    const t0 = process.hrtime.bigint();
    const base = (process.env.JWT_SERVICE_URL || '').replace(/\/+$/, '');
    const groupId = req?.user?.group;

    // Pré-log: intenção da checagem
    log.info?.(
      {
        requestId,
        middleware: 'authorizeGroupResource',
        resourceName,
        requiredPerm,
        authServiceBase: base,
        groupId,
        path: req.originalUrl,
        method: req.method,
      },
      'authz:start'
    );

    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) {
        log.warn?.({ requestId }, 'authz:token_missing');
        return res.status(401).json({ message: 'Token ausente' });
      }
      if (!groupId) {
        log.warn?.({ requestId }, 'authz:group_missing');
        return res.status(401).json({ message: 'Usuário sem grupo' });
      }
      if (!base) {
        log.error?.({ requestId }, 'authz:auth_service_base_missing');
        return res.status(500).json({ message: 'Config JWT_SERVICE_URL ausente' });
      }

      const url = new URL(
        `grants/effective?groupId=${encodeURIComponent(groupId)}&resourceName=${encodeURIComponent(resourceName)}`,
        base + '/'
      ).toString();

      // Em desenvolvimento, permite certificados autoassinados; em produção, valida SSL
      const isDev = process.env.NODE_ENV === 'development';
      const agent = new https.Agent({ rejectUnauthorized: !isDev });
      const { data: grant } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        httpsAgent: agent,
        timeout: 7000,
        validateStatus: () => true, // loga qualquer status
      });

      // Log da resposta do auth-service
      log.info?.(
        {
          requestId,
          url,
          status: grant?.status || 'ok',
          grantType: typeof grant,
          grantPreview:
            grant && typeof grant === 'object'
              ? {
                  perms: grant.perms,
                  scope: grant.scope,
                  isAdmin: grant.isAdmin,
                  groupName: grant.groupName,
                }
              : undefined,
        },
        'authz:auth_service_response'
      );

      // Status HTTP diferente de 200
      if (!grant || typeof grant.perms !== 'number') {
        const msg = grant?.message || 'Grant inválido';
        log.warn?.({ requestId, url, msg }, 'authz:grant_invalid');
        return res.status(403).json({ message: 'Grant inválido' });
      }

      if ((grant.perms & requiredPerm) !== requiredPerm) {
        log.warn?.(
          {
            requestId,
            requiredPerm,
            grantedPerms: grant.perms,
            scope: grant.scope,
            groupName: grant.groupName,
          },
          'authz:denied'
        );
        return res.status(403).json({ message: 'Não autorizado' });
      }

      const full = PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE; // 15
      const isAdmin =
        grant.isAdmin === true ||
        grant.groupName === 'admin' ||
        grant.scope === 'all' ||
        ((grant.perms & full) === full && grant.scope === 'all');

      req.access = { ...(req.access || {}), isAdmin };
      req.grant = grant;

      const t1 = process.hrtime.bigint();
      log.info?.(
        {
          requestId,
          latencyMs: Number(t1 - t0) / 1e6,
          isAdmin,
          grantedPerms: grant.perms,
        },
        'authz:allowed'
      );

      return next();
    } catch (err) {
      const status = err?.response?.status || 502;
      const data = err?.response?.data;
      const code = err?.code;
      const url = (() => {
        try {
          const b = (process.env.JWT_SERVICE_URL || '').replace(/\/+$/, '');
          return new URL(
            `grants/effective?groupId=${encodeURIComponent(req?.user?.group)}&resourceName=${encodeURIComponent(resourceName)}`,
            b + '/'
          ).toString();
        } catch {
          return undefined;
        }
      })();

      // Log de erro detalhado sem vazar token
      log.error?.(
        {
          requestId,
          status,
          code,
          url,
          responseMessage: data?.message,
          responseDetail: data?.detail,
          stack: err?.stack,
        },
        'authz:error'
      );

      const t1 = process.hrtime.bigint();
      return res.status(502).json({
        message: 'Auth-service indisponível',
        detail: data?.message || code || 'ERR',
        status,
        latencyMs: Number(t1 - t0) / 1e6,
      });
    }
  };
}

export { PERM } from './GroupResourceGrant.js';
