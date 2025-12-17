// src/middlewares/buildRecursiveScopeAgent.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';

function urlJoin(base, path) {
  const b = base.endsWith('/') ? base : base + '/';
  const p = path.startsWith('/') ? path.slice(1) : path;
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
function pickId(v) {
  return String(v?._id || v?.id || '').trim();
}

function pickBcId(re) {
  const v =
    re?.bankCorrespondentId ||
    re?.correspondentId ||
    re?.bankCorrespondent?._id ||
    re?.correspondent?._id ||
    (Array.isArray(re?.bankCorrespondentIds) && re.bankCorrespondentIds[0]);
  return v ? String(v) : '';
}

/**
 * Coleta IDs de agents, correspondentes e imobiliárias do OWNER e do GROUP.
 * Além de buscar correspondentes diretamente, infere correspondentes a partir das imobiliárias do usuário/grupo.
 * Salva em:
 *  - req.scope.ownerAgentIds, req.scope.groupAgentIds
 *  - req.scope.ownerBcIds, req.scope.groupBcIds
 *  - req.scope.ownerRealEstateIds, req.scope.groupRealEstateIds
 *  - req.scope.realEstateIds (owner ∪ group)
 */
export async function buildRecursiveScopeAgent(req, _res, next) {
  const scope = {};
  try {
    const token = (req.headers.authorization || '').trim();

    // === ENV NAMES FIXADOS ===
    const agBase = String(process.env.AGENT_SERVICE_URL || '').trim();
    const bcBase = String(process.env.BANK_CORRESPONDENT_SERVICE_URL || '').trim();
    const reBase = String(process.env.REAL_ESTATE_SERVICE_URL || '').trim();
    const httpsAgent = new https.Agent({
      rejectUnauthorized: !(process.env.NODE_ENV === 'development' || process.env.SKIP_TLS_VERIFY === 'true'),
    });
    const headers = token ? { Authorization: token } : undefined;
    const timeout = 7000;

    const sub = String(req.user?.sub || '');
    const group = String(req.user?.group || '');

    const ownerAgentIds = new Set();
    const groupAgentIds = new Set();
    const ownerReIds    = new Set();
    const groupReIds    = new Set();

    // ---- Agents do OWNER ----
    if (agBase && sub) {
      const ownerCandidates = [
        'v1/agents/by-owner/:ownerAuthId',
        'v1/agents?ownerAuthId=:ownerAuthId',
        'v1/agents?ownerId=:ownerAuthId',
      ];
      for (const p of ownerCandidates) {
        try {
          const path = p.includes('?') ? p.replace(':ownerAuthId', encodeURIComponent(sub)) : replaceVars(p, { ownerAuthId: sub });
          const url = urlJoin(agBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => {
            const v = pickId(it);
            if (v) ownerAgentIds.add(v);
            (it?.realEstateIds || []).forEach(rid => rid && ownerReIds.add(String(rid)));
          });
          if (ownerAgentIds.size) break;
        } catch {}
      }
    }

    // ---- Agents do GROUP ----
    if (agBase && group) {
      const groupCandidates = [
        'v1/agents?groupId=:groupId',
        'v1/agents/by-group/:groupId',
        'v1/agents/group/:groupId',
      ];
      for (const p of groupCandidates) {
        try {
          const path = p.includes('?') ? p.replace(':groupId', encodeURIComponent(group)) : replaceVars(p, { groupId: group });
          const url = urlJoin(agBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => {
            const v = pickId(it);
            if (v) groupAgentIds.add(v);
            (it?.realEstateIds || []).forEach(rid => rid && groupReIds.add(String(rid)));
          });
        } catch {}
      }
    }

    // ---- Correspondentes do OWNER (direto) ----
    const ownerBcIds = new Set();
    if (bcBase && sub) {
      const ownerCandidates = [
        'v1/bank-correspondents/by-owner/:ownerAuthId',
        'v1/bank-correspondents?ownerAuthId=:ownerAuthId',
        'v1/bank-correspondents?ownerId=:ownerAuthId',
      ];
      for (const p of ownerCandidates) {
        try {
          const path = p.includes('?') ? p.replace(':ownerAuthId', encodeURIComponent(sub)) : replaceVars(p, { ownerAuthId: sub });
          const url = urlJoin(bcBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => { const v = pickId(it); if (v) ownerBcIds.add(v); });
          if (ownerBcIds.size) break;
        } catch {}
      }
    }

    // ---- Correspondentes do GROUP (direto) ----
    const groupBcIds = new Set();
    if (bcBase && group) {
      const groupCandidates = [
        'v1/bank-correspondents?groupId=:groupId',
        'v1/bank-correspondents/by-group/:groupId',
        'v1/bank-correspondents/group/:groupId',
      ];
      for (const p of groupCandidates) {
        try {
          const path = p.includes('?') ? p.replace(':groupId', encodeURIComponent(group)) : replaceVars(p, { groupId: group });
          const url = urlJoin(bcBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => { const v = pickId(it); if (v) groupBcIds.add(v); });
        } catch {}
      }
    }

    // ---- RealEstates por CORRESPONDENTE ----
    async function fetchREByCorrespondents(bcIds) {
      const ids = new Set();
      if (!reBase || bcIds.size === 0) return [];
      for (const bcId of bcIds) {
        const candidates = [
          'v1/real-estates/by-correspondent/:bcId',
          'v1/real-estates?bankCorrespondentId=:bcId',
          'v1/real-estates?correspondentId=:bcId',
        ];
        for (const p of candidates) {
          try {
            const path = p.includes('?') ? p.replace(':bcId', encodeURIComponent(bcId)) : replaceVars(p, { bcId });
            const url = urlJoin(reBase, path);
            const data = await fetchJson(url, { headers, httpsAgent, timeout });
            const arr = Array.isArray(data) ? data : [data];
            arr.forEach(it => { const v = pickId(it); if (v) ids.add(v); });
            if (ids.size) break;
          } catch {}
        }
      }
      return Array.from(ids);
    }

    // ---- RealEstates do OWNER via ownerAuthId ----
    async function fetchREByOwner(ownerAuthId) {
      const out = { reIds: new Set(), bcIds: new Set() };
      if (!reBase || !ownerAuthId) return out;
      const candidates = [
        'v1/real-estates/by-owner/:ownerAuthId',
        'v1/real-estates?ownerAuthId=:ownerAuthId',
        'v1/real-estates?ownerId=:ownerAuthId',
      ];
      for (const p of candidates) {
        try {
          const path = p.includes('?') ? p.replace(':ownerAuthId', encodeURIComponent(ownerAuthId)) : replaceVars(p, { ownerAuthId });
          const url = urlJoin(reBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => {
            const reId = pickId(it);
            const bcId = pickBcId(it);
            if (reId) out.reIds.add(reId);
            if (bcId) out.bcIds.add(bcId);
          });
          if (out.reIds.size) break;
        } catch {}
      }
      return out;
    }

    async function fetchREByGroup(groupId) {
      const out = { reIds: new Set(), bcIds: new Set() };
      if (!reBase || !groupId) return out;
      const candidates = [
        'v1/real-estates?groupId=:groupId',
        'v1/real-estates/by-group/:groupId',
        'v1/real-estates/group/:groupId',
      ];
      for (const p of candidates) {
        try {
          const path = p.includes('?') ? p.replace(':groupId', encodeURIComponent(groupId)) : replaceVars(p, { groupId });
          const url = urlJoin(reBase, path);
          const data = await fetchJson(url, { headers, httpsAgent, timeout });
          const arr = Array.isArray(data) ? data : [data];
          arr.forEach(it => {
            const reId = pickId(it);
            const bcId = pickBcId(it);
            if (reId) out.reIds.add(reId);
            if (bcId) out.bcIds.add(bcId);
          });
          if (out.reIds.size) break;
        } catch {}
      }
      return out;
    }

    // Owner/Group RE and inferred BCs
    const ownerRE = await fetchREByOwner(sub);
    const groupRE = await fetchREByGroup(group);

    // Merge inferred BCs
    ownerRE.bcIds.forEach(id => ownerBcIds.add(id));
    groupRE.bcIds.forEach(id => groupBcIds.add(id));

    // REs by BCs (existing path)
    const reFromOwnerBC = await fetchREByCorrespondents(ownerBcIds);
    const reFromGroupBC = await fetchREByCorrespondents(groupBcIds);

    // Persist scope
    scope.ownerAgentIds = uniqStrings(Array.from(ownerAgentIds));
    scope.groupAgentIds = uniqStrings(Array.from(groupAgentIds));

    const ownerReAll = uniqStrings([
      ...Array.from(ownerReIds),
      ...Array.from(ownerRE.reIds || []),
      ...reFromOwnerBC,
    ]);
    const groupReAll = uniqStrings([
      ...Array.from(groupReIds),
      ...Array.from(groupRE.reIds || []),
      ...reFromGroupBC,
    ]);
    scope.ownerRealEstateIds = ownerReAll;
    scope.groupRealEstateIds = groupReAll;
    scope.realEstateIds      = uniqStrings([...ownerReAll, ...groupReAll]);

    scope.ownerBcIds = uniqStrings(Array.from(ownerBcIds));
    scope.groupBcIds = uniqStrings(Array.from(groupBcIds));
  } catch (err) {
    logger.error('Erro ao montar escopo de agent', { err: err?.message });
  }
  req.scope = scope;
  return next();
}

export default buildRecursiveScopeAgent;
