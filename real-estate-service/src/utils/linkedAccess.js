// src/utils/linkedAccess.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';

const httpsAgent = new https.Agent({
  rejectUnauthorized: !(
    process.env.NODE_ENV !== 'production' && String(process.env.SKIP_TLS_VERIFY || 'true') === 'true'
  ),
});

const AGENT_BASE = (process.env.APP_AGENT_SERVICE_URL || '').replace(/\/+$/, '');
const BC_BASE    = (process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || '').replace(/\/+$/, '');

const authHeaders = (req) =>
  req.headers?.authorization ? { Authorization: req.headers.authorization } : {};

const toSet = (arr) => new Set((Array.isArray(arr) ? arr : []).map((x) => String(x)));

export async function userIsLinkedToRE(req, reDoc) {
  const sub = String(req.user?.sub || '');
  const adminFlag =
    req?.access?.isAdmin === true ||
    req?.user?.isAdmin === true ||
    String(req?.user?.groupName || '').toLowerCase() === 'admin';

  if (!reDoc || !sub) return false;
  if (adminFlag) return true;

  // owner da imobiliária
  if (String(reDoc.ownerAuthId) === sub) {
    logger.debug('userIsLinkedToRE owner match', { reId: reDoc._id, sub });
    return true;
  }

  // 1) Checagem local via escopo já resolvido pelo middleware
  const scopeBCs = toSet(req?.scope?.ownerBankCorrespondentIds || []);
  if (scopeBCs.size && Array.isArray(reDoc.bankCorrespondentIds) && reDoc.bankCorrespondentIds.length) {
    const reBCs = toSet(reDoc.bankCorrespondentIds);
    for (const id of reBCs) {
      if (scopeBCs.has(id)) {
        logger.debug('userIsLinkedToRE BC scope match', { reId: reDoc._id, sub, bcId: id });
        return true;
      }
    }
  }

  const scopeREs = toSet(req?.scope?.realEstateIds || []);
  if (scopeREs.size && scopeREs.has(String(reDoc._id))) {
    logger.debug('userIsLinkedToRE RE scope match', { reId: reDoc._id, sub });
    return true;
  }

  // 2) Fallback remoto via AGENT → realEstateIds contém o id consultado
  if (AGENT_BASE) {
    try {
      const { data } = await axios.get(
        `${AGENT_BASE}/v1/agents/by-owner/${encodeURIComponent(sub)}?status=active`,
        { headers: authHeaders(req), httpsAgent, timeout: 7000, validateStatus: (s) => s < 500 }
      );
      const list = Array.isArray(data) ? data : (data ? [data] : []);
      if (list.some((a) => (a.realEstateIds || []).map(String).includes(String(reDoc._id)))) {
        logger.debug('userIsLinkedToRE remote agent match', { reId: reDoc._id, sub });
        return true;
      }
    } catch {}
  }

  // 3) Fallback remoto via BANK-CORRESPONDENT → interseção com re.bankCorrespondentIds
  if (BC_BASE && Array.isArray(reDoc.bankCorrespondentIds) && reDoc.bankCorrespondentIds.length) {
    try {
      const { data } = await axios.get(
        `${BC_BASE}/v1/bank-correspondents/by-owner/${encodeURIComponent(sub)}?status=active`,
        { headers: authHeaders(req), httpsAgent, timeout: 7000, validateStatus: (s) => s < 500 }
      );
      const list = Array.isArray(data) ? data : (data ? [data] : []);
      const bcIds = toSet(reDoc.bankCorrespondentIds);
      if (list.some((bc) => bcIds.has(String(bc._id)))) {
        logger.debug('userIsLinkedToRE remote BC match', { reId: reDoc._id, sub });
        return true;
      }
    } catch {}
  }
  logger.debug('userIsLinkedToRE denied', {
    reId: reDoc._id,
    sub,
    ownerAuthId: reDoc.ownerAuthId,
    reBankCorrespondentIds: reDoc.bankCorrespondentIds,
    scopeOwnerBCs: req.scope?.ownerBankCorrespondentIds,
    scopeREs: req.scope?.realEstateIds,
  });
  return false;
}
