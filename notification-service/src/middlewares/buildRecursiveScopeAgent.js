// src/middlewares/buildRecursiveScopeAgent.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';

function urlJoin(base, path) {
  const b = base.endsWith('/') ? base : base + '/';
  const p = path.startsWith('/') ? path.slice(1) : path; // preserva /v1 da base
  return new URL(p, b).toString().replace(/\/+$/,'');
}
function replaceVars(path, vars) {
  return path.replace(/:([A-Za-z_]\w*)/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
}
function uniqStrings(arr) {
  return Array.from(new Set((arr || []).map(String).filter(Boolean)));
}
async function fetchJson(url, cfg) {
  const { data } = await axios.get(url, cfg);
  return data;
}

/**
 * Coleta IDs de correspondentes e imobiliárias do OWNER e do GROUP.
 * Salva em:
 *  - req.scope.ownerBcIds, req.scope.groupBcIds
 *  - req.scope.ownerRealEstateIds, req.scope.groupRealEstateIds
 *  - req.scope.realEstateIds (owner ∪ group, compat)
 */
export async function buildRecursiveScopeAgent(req, _res, next) {
  const scope = {};
  try {
    const token = (req.headers.authorization || '').trim();
    const bcBase = String(process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || process.env.BC_SERVICE_URL || '').trim();
    const reBase = String(process.env.APP_REAL_ESTATE_SERVICE_URL || '').trim();

    if (!bcBase) { req.scope = scope; return next(); }

    const httpsAgent = new https.Agent({
      rejectUnauthorized: !(process.env.NODE_ENV === 'development' || process.env.SKIP_TLS_VERIFY === 'true'),
    });
    const headers = token ? { Authorization: token } : undefined;
    const timeout = 7000;

    const sub = String(req.user?.sub || '');
    const group = String(req.user?.group || '');

    // ---- Correspondentes do OWNER ----
    const ownerBcIds = new Set();
    const ownerCandidates = [
      'bank-correspondents/by-owner/:ownerAuthId',
      'bank-correspondents?ownerAuthId=:ownerAuthId',
      'bank-correspondents?ownerId=:ownerAuthId',
    ];
    for (const p of ownerCandidates) {
      try {
        const path = p.includes('?') ? p.replace(':ownerAuthId', encodeURIComponent(sub)) : replaceVars(p, { ownerAuthId: sub });
        const url = urlJoin(bcBase, path);
        const data = await fetchJson(url, { headers, httpsAgent, timeout });
        const arr = Array.isArray(data) ? data : [data];
        arr.forEach(it => { const v = String(it?._id || it?.id || ''); if (v) ownerBcIds.add(v); });
        if (ownerBcIds.size) break;
      } catch {}
    }

    // ---- Correspondentes do GROUP ----
    const groupBcIds = new Set();
    if (group) {
      const groupCandidates = [
        'bank-correspondents?groupId=:groupId',
        'bank-correspondents/by-group/:groupId',
        'bank-correspondents/group/:groupId',
      ];
      for (const p of groupCandidates) {
        try {
          const path = p.includes('?') ? p.replace(':groupId', encodeURIComponent(group)) : replaceVars(p, { groupId: group });
          const url = urlJoin(bcBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => { const v = String(it?._id || it?.id || ''); if (v) groupBcIds.add(v); });
        } catch {}
      }
    }

    // ---- RealEstates para cada conjunto ----
    async function fetchREByCorrespondents(bcIds) {
      const ids = new Set();
      if (!reBase || bcIds.size === 0) return [];
      for (const bcId of bcIds) {
        const candidates = [
          'real-estates/by-correspondent/:bcId',
          'real-estates?bankCorrespondentId=:bcId',
          'real-estates?correspondentId=:bcId',
        ];
        for (const p of candidates) {
          try {
            const path = p.includes('?') ? p.replace(':bcId', encodeURIComponent(bcId)) : replaceVars(p, { bcId });
            const url = urlJoin(reBase, path);
            const data = await fetchJson(url, { headers, httpsAgent, timeout });
            const arr = Array.isArray(data) ? data : [data];
            arr.forEach(it => {
              const v = String(it?._id || it?.id || '');
              if (v) ids.add(v);
            });
            if (ids.size) break; // achou para esse bc
          } catch {}
        }
      }
      return Array.from(ids);
    }

    const ownerRealEstateIds = await fetchREByCorrespondents(ownerBcIds);
    const groupRealEstateIds = await fetchREByCorrespondents(groupBcIds);

    scope.ownerBcIds = uniqStrings(Array.from(ownerBcIds));
    scope.groupBcIds = uniqStrings(Array.from(groupBcIds));
    scope.ownerRealEstateIds = uniqStrings(ownerRealEstateIds);
    scope.groupRealEstateIds = uniqStrings(groupRealEstateIds);
    scope.realEstateIds = uniqStrings([...ownerRealEstateIds, ...groupRealEstateIds]); // compat

    if (process.env.NODE_ENV !== 'production') {
      logger.debug('agent-scope', {
        ownerBcIds: scope.ownerBcIds,
        groupBcIds: scope.groupBcIds,
        ownerREs: scope.ownerRealEstateIds,
        groupREs: scope.groupRealEstateIds,
      });
    }
  } catch (err) {
    logger.error('Erro ao montar escopo de agent', { err: err?.message });
  }

  req.scope = scope;
  return next();
}

export default buildRecursiveScopeAgent;
