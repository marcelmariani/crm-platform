// src/domain/contractStatusView.js
// Padrão alinhado ao proposalStatusView do sales-service:
// - Cache local com TTL
// - Funções de "view" e de enriquecimento de documentos/listas
// - Fallbacks seguros quando status não existe/inativo

import ContractStatus from '../models/contractStatus.js';

const TTL_MS = Number(process.env.CONTRACT_STATUS_CACHE_TTL_MS || 30000);

let _cache = new Map();       // key → row
let _loadedAt = 0;
let _loadPromise = null;

function _now() { return Date.now(); }
function _fresh() { return _now() - _loadedAt < TTL_MS; }

async function _loadActive() {
  const rows = await ContractStatus.find({
    $or: [{ isActive: true }, { status: 'active' }],
  })
    .select({
      key: 1,
      descriptionPtBr: 1,
      type: 1,
      status: 1,
      isActive: 1,
      defaultDeadlineDays: 1,
    })
    .lean();

  const map = new Map();
  for (const r of rows) {
    const key = String(r.key || '').toLowerCase();
    if (!key) continue;
    map.set(key, {
      key,
      descriptionPtBr: r.descriptionPtBr,
      type: r.type === 'custom' ? 'custom' : 'system',
      status: r.status === 'inactive' ? 'inactive' : 'active',
      isActive: r.isActive !== false, // compat legado
      defaultDeadlineDays: Number.isFinite(Number(r.defaultDeadlineDays))
        ? Number(r.defaultDeadlineDays)
        : 3,
    });
  }
  _cache = map;
  _loadedAt = _now();
}

async function _ensureCache() {
  if (_fresh() && _cache.size > 0) return;
  if (_loadPromise) {
    try { await _loadPromise; return; } catch { /* fall-through */ }
  }
  _loadPromise = _loadActive();
  try { await _loadPromise; } finally { _loadPromise = null; }
}

/**
 * Retorna metadados padronizados do status.
 * @param {string} key
 * @returns {{statusPtBr:string|undefined,statusType:'system'|'custom'|undefined,statusState:'active'|'inactive'|undefined,defaultDeadlineDays:number}}
 */
export async function statusView(key) {
  await _ensureCache();
  const k = String(key || '').toLowerCase();
  const row = _cache.get(k);
  if (!row) {
    return {
      statusPtBr: undefined,
      statusType: undefined,
      statusState: undefined,
      defaultDeadlineDays: 3,
    };
  }
  return {
    statusPtBr: row.descriptionPtBr,
    statusType: row.type,
    statusState: row.status === 'inactive' || row.isActive === false ? 'inactive' : 'active',
    defaultDeadlineDays: Number.isFinite(Number(row.defaultDeadlineDays))
      ? Number(row.defaultDeadlineDays)
      : 3,
  };
}

/**
 * Retorna dias de deadline padrão para um status.
 * @param {string} key
 * @returns {number}
 */
export async function defaultDeadlineDays(key) {
  const v = await statusView(key);
  return Number(v.defaultDeadlineDays ?? 3);
}

/**
 * Enriquecer um item "status stack" com pt-br, tipo e state.
 * Mutável por padrão para evitar alocação extra. Defina copy=true para retornar cópia.
 * @param {{status:string,statusPtBr?:string,statusType?:string,statusState?:string}} stackItem
 * @param {boolean} copy
 * @returns {object}
 */
export async function enrichStackItem(stackItem, copy = false) {
  if (!stackItem || !stackItem.status) return stackItem;
  const view = await statusView(stackItem.status);
  if (copy) {
    return {
      ...stackItem,
      statusPtBr: view.statusPtBr,
      statusType: view.statusType,
      statusState: view.statusState,
    };
  }
  stackItem.statusPtBr = view.statusPtBr;
  stackItem.statusType = view.statusType;
  stackItem.statusState = view.statusState;
  return stackItem;
}

/**
 * Enriquecer um documento de contrato com dados do status[0].
 * Retorna o mesmo objeto (mutável) por padrão.
 * @param {{status?:Array}} contractDoc
 * @param {boolean} copy
 * @returns {object}
 */
export async function enrichContractDoc(contractDoc, copy = false) {
  if (!contractDoc) return contractDoc;
  const ret = copy ? { ...contractDoc } : contractDoc;
  const s0 = Array.isArray(ret.status) && ret.status[0] ? ret.status[0] : null;
  if (s0 && s0.status) {
    await enrichStackItem(s0, false);
  }
  return ret;
}

/**
 * Enriquecer lista de contratos.
 * @param {Array<object>} docs
 * @param {boolean} copy
 * @returns {Promise<Array<object>>}
 */
export async function enrichContractList(docs = [], copy = false) {
  if (!Array.isArray(docs) || docs.length === 0) return docs;
  await _ensureCache(); // otimiza chamadas repetidas
  const out = [];
  for (const d of docs) {
    out.push(await enrichContractDoc(d, copy));
  }
  return out;
}

/**
 * Invalida o cache (use em seeds/bootstraps/tests).
 */
export function invalidateContractStatusCache() {
  _cache = new Map();
  _loadedAt = 0;
}
