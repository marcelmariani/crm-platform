// src/controllers/contractController.js
import mongoose from 'mongoose';
import axios from 'axios';
import https from 'https';
import Contract from '../models/contractModel.js';
import ContractStatus from '../models/contractStatus.js';
import contractSequence from '../models/contractSequence.js';
import logger from '../config/logger.js';
import eventQueue from '../queues/eventQueue.js';
import * as notifier from '../notification/notificationPublisher.js';

const CONTACT_BASE = (process.env.CONTACT_SERVICE_URL || '').replace(/\/+$/, '');
const PRODUCT_BASE = (process.env.PRODUCT_SERVICE_URL || '').replace(/\/+$/, '');
const SELLER_BASE  = (process.env.SELLER_SERVICE_URL  || '').replace(/\/+$/, '');
const REAL_ESTATE_BASE = (process.env.REAL_ESTATE_SERVICE_URL || '').replace(/\/+$/, '');

const addDays = (d, n) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
const pad8 = (n) => String(Number(n || 0)).padStart(8, '0');

const httpsAgent = new https.Agent({
  rejectUnauthorized: !(process.env.NODE_ENV === 'development' || process.env.SKIP_TLS_VERIFY === 'true'),
});

async function httpGet(url, headers = {}) {
  const res = await axios.get(url, { headers, httpsAgent, timeout: 8000, validateStatus: s => s >= 200 && s < 500 });
  if (res.status >= 400) { const e = new Error(res.data?.message || `HTTP ${res.status}`); e.status = res.status; e.detail = res.data; throw e; }
  return res.data;
}
const authHeader = (req) => (req.headers?.authorization ? { Authorization: req.headers.authorization } : {});
const unique = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

// ===== Novo fluxo (matriz de transições) =====
export const CONTRACT_STATUS = [
  'draft','awaiting_documents','in_review','awaiting_signatures','signed',
  'submitted_to_bank','bank_requirements','approved','rejected','active','settled','canceled','expired'
];

export const CONTRACT_STATUS_FLOW = {
  draft: ['awaiting_documents','in_review','canceled','expired'],
  awaiting_documents: ['in_review','canceled','expired'],
  in_review: ['awaiting_signatures','rejected','canceled'],
  awaiting_signatures: ['signed','canceled','expired'],
  signed: ['submitted_to_bank','canceled'],
  submitted_to_bank: ['bank_requirements','approved','rejected','canceled'],
  bank_requirements: ['submitted_to_bank','canceled'],
  approved: ['active','canceled'],
  active: ['settled','canceled'],
  settled: [],
  rejected: [],
  canceled: [],
  expired: ['draft'],
};

const BLOCK_PRODUCT_EDIT_FROM = new Set([
  'submitted_to_bank','bank_requirements','approved','rejected','active','settled','canceled','expired'
]);

const isSystem = (row) => row ? (row.type ? row.type === 'system' : !!row.isSystemic) : false;
const isActiveRow = (row) => row ? (row.status ? row.status === 'active' : !!row.isActive) : false;

async function statusView(key) {
  const row = await ContractStatus.findOne({ key: String(key).toLowerCase() }).lean();
  if (!row) return { statusPtBr: undefined, statusType: undefined, statusState: undefined, defaultDeadlineDays: 3 };
  return {
    statusPtBr: row.descriptionPtBr,
    statusType: isSystem(row) ? 'system' : 'custom',
    statusState: isActiveRow(row) ? 'active' : 'inactive',
    defaultDeadlineDays: Number(row.defaultDeadlineDays ?? 3),
  };
}

function currentKey(doc) {
  const s0 = Array.isArray(doc.status) && doc.status[0] ? doc.status[0] : null;
  return String(s0?.status || 'draft').toLowerCase();
}

async function resolveAndCheckTargetStatus({ contract, targetKey }) {
  const key = String(targetKey).toLowerCase();
  const target = await ContractStatus.findOne({ key, $or: [{ isActive: true }, { status: 'active' }] }).lean();
  if (!target) { const e = new Error('Status inválido'); e.status = 400; throw e; }

  const from = currentKey(contract);
  if (from === key) { const e = new Error('Status igual ao atual'); e.status = 400; throw e; }

  const allowed = CONTRACT_STATUS_FLOW[from] || [];
  if (!allowed.includes(key)) {
    const e = new Error(`Transição não permitida: ${from} → ${key}`);
    e.status = 400; throw e;
  }
  return target;
}

// ====== escopo ======
function buildAccessFilter(req) {
  const isAdmin = req?.access?.isAdmin === true;
  const scope = String(req?.grant?.scope || '').toLowerCase();
  if (isAdmin || scope === 'all') return {};
  const sub = String(req.user?.sub || '');
  if (!sub) return { _id: null };
  if (scope === 'own' || !scope) {
    return { $or: [
      { 'auditInformation.0.createdByAuthId': sub },
      { createdByAuthId: sub }
    ]};
  }
  const reIds = Array.isArray(req?.scope?.realEstateIds) ? req.scope.realEstateIds : [];
  const bcIds = [
    ...(Array.isArray(req?.scope?.ownerBcIds) ? req.scope.ownerBcIds : []),
    ...(Array.isArray(req?.scope?.groupBcIds) ? req.scope.groupBcIds : []),
  ];
  const or = [
    { 'auditInformation.0.createdByAuthId': sub },
    { createdByAuthId: sub }
  ];
  if (reIds.length) or.push({ createdAtRealEstateId: { $in: reIds } });
  if (bcIds.length) or.push({ createdAtBankCorrespondentId: { $in: bcIds } });
  return { $or: or };
}

const notFound = (res) => res.status(404).json({ error: 'Contrato não encontrado' });

function toResponse(doc) {
  const d = doc?.toObject ? doc.toObject() : { ...doc };
  const {
    _id,
    sequenceNumber,              // ← removido do retorno
    proposalSequenceNumber,      // ← removido do retorno
    createdAtAgentId, createdAtRealEstateId, createdAtBankCorrespondentId,
    createdAt, updatedAt, auditInformation = [],
    ...rest
  } = d;

  const audit = Array.isArray(auditInformation) && auditInformation.length ? [...auditInformation] : [{}];
  const ai0 = audit[0] || {};
  if (createdAtAgentId) ai0.createdAtAgentId = String(createdAtAgentId);
  if (createdAtRealEstateId) ai0.createdAtRealEstateId = String(createdAtRealEstateId);
  if (createdAtBankCorrespondentId) ai0.createdAtBankCorrespondentId = String(createdAtBankCorrespondentId);
  if (!ai0.createdAt && createdAt) ai0.createdAt = createdAt;
  if (!ai0.updatedAt && updatedAt) ai0.updatedAt = updatedAt;
  audit[0] = ai0;

  // mantém apenas os derivados públicos
  const pad8 = (n) => String(Number(n || 0)).padStart(8, '0');
  const contractNumber = Number.isFinite(d.sequenceNumber) ? pad8(d.sequenceNumber) : undefined;
  const proposalNumber = Number.isFinite(d.proposalSequenceNumber) ? pad8(d.proposalSequenceNumber) : undefined;

  return {
    _id,
    contractNumber,
    proposalNumber,
    ...rest,
    auditInformation: audit,
  };
}

// ====== validações externas ======
function ensureActive(obj) {
  if (typeof obj?.isActive === 'boolean') return obj.isActive === true;
  const st = obj?.status;
  if (typeof st === 'string') return st.toLowerCase() === 'active';
  if (Array.isArray(st)) {
    const s0 = st[0];
    if (typeof s0 === 'string') return s0.toLowerCase() === 'active';
    if (s0 && typeof s0.status === 'string') return s0.status.toLowerCase() === 'active';
  }
  if (typeof obj?.statusState === 'string') return obj.statusState.toLowerCase() === 'active';
  return false;
}

async function validateBuyersProductsSellers({ req, buyerIds = [], products = [], sellerIds = [] }) {
  const missVars = [];
  if (!CONTACT_BASE) missVars.push('CONTACT_SERVICE_URL');
  if (!PRODUCT_BASE) missVars.push('PRODUCT_SERVICE_URL');
  if (!SELLER_BASE)  missVars.push('SELLER_SERVICE_URL');
  if (missVars.length) { const err = new Error(`Variáveis ausentes: ${missVars.join(', ')}`); err.status = 500; throw err; }

  const headers = authHeader(req);

  for (const bid of buyerIds) {
    const contact = await httpGet(`${CONTACT_BASE}/v1/contacts/${bid}`, headers);
    const type = String(contact?.type || '').toLowerCase();
    if (type !== 'client') { const e = new Error(`Buyer ${bid} precisa ser do tipo CLIENTE`); e.status = 422; throw e; }
    if (!ensureActive(contact)) { const e = new Error(`Buyer ${bid} inativo`); e.status = 422; throw e; }
  }

  for (const sid of sellerIds) {
    const seller = await httpGet(`${SELLER_BASE}/v1/sellers/${sid}`, headers);
    if (!ensureActive(seller)) { const e = new Error(`Seller ${sid} inativo`); e.status = 422; throw e; }
  }

  const productIds = unique((products || []).map(p => String(p?.productId || '')));
  if (!productIds.length) { const e = new Error('Lista de produtos inválida: productId ausente'); e.status = 400; throw e; }
  for (const pid of productIds) {
    const product = await httpGet(`${PRODUCT_BASE}/v1/products/${pid}`, headers);
    if (!ensureActive(product)) { const e = new Error(`Produto ${pid} inativo`); e.status = 422; throw e; }
  }
}

// ====== handlers de atalho por status ======
const setStatusHandler = (targetKey) => async (req, res) => {
  const note = req.body?.note;
  const deadline = req.body?.statusDeadlineAt;
  req.body = { status: targetKey, statusChangeNote: note, statusDeadlineAt: deadline };
  return updatecontract(req, res);
};

export const setDraft               = setStatusHandler('draft');
export const setAwaitingDocuments   = setStatusHandler('awaiting_documents');
export const setInReview            = setStatusHandler('in_review');
export const setAwaitingSignatures  = setStatusHandler('awaiting_signatures');
export const setSigned              = setStatusHandler('signed');
export const setSubmittedToBank     = setStatusHandler('submitted_to_bank');
export const setBankRequirements    = setStatusHandler('bank_requirements');
export const setApproved            = setStatusHandler('approved');
export const setRejected            = setStatusHandler('rejected');
export const setActive              = setStatusHandler('active');
export const setSettled             = setStatusHandler('settled');
export const setCanceled            = setStatusHandler('canceled');
export const setExpired             = setStatusHandler('expired');

// ====== CREATE ======
export async function createcontract(req, res) {

  const {
    buyerId, sellerId, products,
    proposalId, proposalSequenceNumber
  } = req.body;

  const missing = [];
  if (!Array.isArray(buyerId)  || buyerId.length === 0)  missing.push('buyerId');
  if (!Array.isArray(sellerId) || sellerId.length === 0) missing.push('sellerId');
  if (!Array.isArray(products) || products.length === 0) missing.push('products');
  if (!proposalId) missing.push('proposalId');
  if (!Number.isFinite(Number(proposalSequenceNumber))) missing.push('proposalSequenceNumber');
  if (missing.length) return res.status(400).json({ error: `Campos ausentes: ${missing.join(', ')}` });

  const session = await mongoose.startSession(); session.startTransaction();
  try {
    await validateBuyersProductsSellers({ req, buyerIds: buyerId, products, sellerIds: sellerId });

    const createdByAuthId = String(req.user?.sub || '');
    const createdByUserName = String(req.user?.userName || '');

    const createdAtAgentId =
      Array.isArray(req?.scope?.ownerAgentIds) && req.scope.ownerAgentIds[0]
        ? String(req.scope.ownerAgentIds[0]) : undefined;

    // Real Estate e BC via escopo e fallback
    let createdAtRealEstateId =
      (Array.isArray(req?.scope?.ownerRealEstateIds) && req.scope.ownerRealEstateIds[0])
        ? String(req.scope.ownerRealEstateIds[0])
        : undefined;
    if (!createdAtRealEstateId && Array.isArray(req?.scope?.groupRealEstateIds) && req.scope.groupRealEstateIds[0]) {
      createdAtRealEstateId = String(req.scope.groupRealEstateIds[0]);
    }
    let createdAtBankCorrespondentId =
      (Array.isArray(req?.scope?.ownerBcIds) && req.scope.ownerBcIds[0])
        ? String(req.scope.ownerBcIds[0])
        : undefined;
    if (!createdAtBankCorrespondentId && Array.isArray(req?.scope?.groupBcIds) && req.scope.groupBcIds[0]) {
      createdAtBankCorrespondentId = String(req.scope.groupBcIds[0]);
    }

    if (!createdAtBankCorrespondentId && createdAtRealEstateId && REAL_ESTATE_BASE) {
      try {
        const url = `${REAL_ESTATE_BASE}/v1/real-estates/${createdAtRealEstateId}`;
        const re = await httpGet(url, authHeader(req));
        const firstId = (v) => {
          if (!v) return undefined;
          if (typeof v === 'string') return v;
          if (typeof v === 'object') {
            if (typeof v._id === 'string') return v._id;
            if (v._id != null) return String(v._id);
            if (v.$oid) return String(v.$oid);
            if (v.toString) return String(v.toString());
          }
          return undefined;
        };
        let bc =
          firstId(re?.bankCorrespondentId) ||
          firstId(re?.correspondentId) ||
          firstId(re?.bankCorrespondent) ||
          firstId(re?.correspondent);
        if (!bc && Array.isArray(re?.bankCorrespondentIds) && re.bankCorrespondentIds.length) {
          bc = firstId(re.bankCorrespondentIds[0]);
        }
        if (bc) createdAtBankCorrespondentId = String(bc);
      } catch (e) {
        logger.warn('falha ao obter RE p/ derivar BC', { msg: e?.message });
      }
    }

    if (!createdAtBankCorrespondentId) {
      await session.abortTransaction();
      return res.status(400).json({
        error: 'invalid_operation',
        detail: 'Usuário não possui bank-correspondent com ownerAuthId',
      });
    }

    const initialKey = 'draft';
    const view = await statusView(initialKey);
    const days = Number(view.defaultDeadlineDays ?? 3);
    const now = new Date();

    const seqDoc = await contractSequence.findOneAndUpdate(
      { bankCorrespondentId: createdAtBankCorrespondentId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    const sequenceNumber = Number(seqDoc.seq);

    const [created] = await Contract.create([{
      sequenceNumber,
      proposalId,
      proposalSequenceNumber: Number(proposalSequenceNumber),
      buyerId,
      sellerId,
      products,
      status: [{
        status: initialKey,
        statusStartedAt: now,
        statusDeadlineAt: addDays(now, days),
        statusPtBr: view.statusPtBr,
        statusType: view.statusType,
        statusState: view.statusState,
        statusHistory: [{
          from: null, to: initialKey, note: 'criação',
          changedByAuthId: createdByAuthId, changedByUserName: createdByUserName, changedAt: now
        }]
      }],
      auditInformation: [{
        createdByAuthId,
        createdByUserName,
        createdAt: now,
        updatedAt: now
      }],
      createdAtAgentId,
      createdAtRealEstateId,
      createdAtBankCorrespondentId,
    }], { session });

    await eventQueue.add('sales.contract.created', {
      id: String(created._id),
      sequenceNumber,
      contractNumber: pad8(sequenceNumber),
      proposalSequenceNumber: Number(proposalSequenceNumber),
      proposalNumber: pad8(proposalSequenceNumber),
      createdByAuthId,
      createdAtAgentId,
      createdAtRealEstateId,
      createdAtBankCorrespondentId,
      buyerIds: buyerId.map(String),
      sellerIds: sellerId.map(String),
    });

    await session.commitTransaction();

    // Notificação: criado
    try {
      await notifier.notifyContractCreated({ req, contract: created });
    } catch (e) {
      logger.warn('notify created falhou', { msg: e?.message });
    }

    return res.status(201).json(toResponse(created));
  } catch (err) {
    await session.abortTransaction();
    return res.status(err.status || 400).json({ error: err.message, detail: err.detail });
  } finally { session.endSession(); }
}

// ====== LIST ======
export async function getcontracts(_req, res) {
  try {
    const filter = buildAccessFilter(_req);
    const rows = await Contract.find(filter).lean();
    return res.json(rows.map(toResponse));
  } catch (err) {
    logger.error('contract_list_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  }
}

// ====== GET BY ID ======
export async function getcontractById(req, res) {
  try {
    const filter = { ...(buildAccessFilter(req) || {}), _id: req.params.id };
    const row = await Contract.findOne(filter).lean();
    if (!row) return notFound(res);
    return res.json(toResponse(row));
  } catch (err) {
    logger.error('contract_get_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  }
}

// ====== UPDATE ======
export async function updatecontract(req, res) {
  const session = await mongoose.startSession(); session.startTransaction();
  try {
    const base = buildAccessFilter(req);
    const row = await Contract.findOne({ ...(base || {}), _id: req.params.id }).session(session);
    if (!row) return notFound(res);

    const now = new Date();
    if (!Array.isArray(row.auditInformation) || row.auditInformation.length === 0) {
      row.auditInformation = [{ createdByAuthId: String(req.user?.sub || ''), createdByUserName: String(req.user?.userName || ''), createdAt: row.createdAt || now, updatedAt: now }];
    } else {
      row.auditInformation[0].updatedAt = now;
    }

    const current = currentKey(row);

    // Edição de produtos
    if (Array.isArray(req.body.products) && req.body.products.length) {
      if (BLOCK_PRODUCT_EDIT_FROM.has(current)) {
        return res.status(400).json({ error: 'Status atual não permite alterar produtos' });
      }
      await validateBuyersProductsSellers({
        req,
        buyerIds: Array.isArray(row.buyerId) ? row.buyerId : [],
        sellerIds: Array.isArray(row.sellerId) ? row.sellerId : [],
        products: req.body.products
      });
      row.products = req.body.products;
    }

    // Mudança de status
    if (req.body.status) {
      const targetRow = await resolveAndCheckTargetStatus({ contract: row, targetKey: req.body.status });
      const view = await statusView(targetRow.key);
      const from = current;

      let deadline;
      if (req.body.statusDeadlineAt) {
        const d = new Date(req.body.statusDeadlineAt);
        if (Number.isNaN(d.getTime())) { return res.status(400).json({ error: 'statusDeadlineAt inválido' }); }
        if (d <= now) { return res.status(400).json({ error: 'statusDeadlineAt deve ser maior que statusStartedAt' }); }
        deadline = d;
      } else {
        deadline = addDays(now, Number(view.defaultDeadlineDays ?? 3));
      }

      if (!Array.isArray(row.status) || row.status.length === 0) {
        row.status = [{
          status: targetRow.key,
          statusStartedAt: now,
          statusDeadlineAt: deadline,
          statusPtBr: view.statusPtBr,
          statusType: view.statusType,
          statusState: view.statusState,
          statusHistory: []
        }];
      } else {
        const s0 = row.status[0];
        s0.status = targetRow.key;
        s0.statusStartedAt = now;
        s0.statusDeadlineAt = deadline;
        s0.statusPtBr = view.statusPtBr;
        s0.statusType = view.statusType;
        s0.statusState = view.statusState;
        s0.statusHistory = s0.statusHistory || [];
        s0.statusHistory.push({
          from, to: targetRow.key,
          note: String(req.body.statusChangeNote || '').trim() || undefined,
          changedByAuthId: String(req.user?.sub || ''),
          changedByUserName: String(req.user?.userName || ''),
          changedAt: now
        });
      }

      await eventQueue.add('sales.contract.status_changed', {
        id: String(row._id),
        from,
        to: targetRow.key,
        deadlineAt: deadline.toISOString(),
        sequenceNumber: Number(row.sequenceNumber),
        contractNumber: Number.isFinite(row.sequenceNumber) ? pad8(row.sequenceNumber) : undefined,
      });

      // Notificação: mudança de status
      try {
        await notifier.notifyStatusChanged({
          req,
          contract: row,
          from,
          to: targetRow.key,
          deadlineAt: deadline?.toISOString(),
        });
      } catch (e) {
        logger.warn('notify status_changed falhou', { msg: e?.message });
      }
    }

    await row.save({ session });
    await eventQueue.add('sales.contract.updated', {
      id: String(row._id),
      sequenceNumber: Number(row.sequenceNumber),
      contractNumber: Number.isFinite(row.sequenceNumber) ? pad8(row.sequenceNumber) : undefined,
      proposalSequenceNumber: Number(row.proposalSequenceNumber),
      proposalNumber: Number.isFinite(row.proposalSequenceNumber) ? pad8(row.proposalSequenceNumber) : undefined,
    });
    await session.commitTransaction();

    // Notificação: atualizado
    try {
      await notifier.notifyContractUpdated({ req, contract: row });
    } catch (e) {
      logger.warn('notify updated falhou', { msg: e?.message });
    }

    return res.json(toResponse(row));
  } catch (err) {
    await session.abortTransaction();
    logger.error('contract_update_error', { err: err.message });
    return res.status(err.status || 400).json({ error: err.message, detail: err.detail });
  } finally { session.endSession(); }
}

export async function approvecontract(req, res) {
  req.body = { ...(req.body || {}), status: 'approved', statusChangeNote: 'approve endpoint' };
  return updatecontract(req, res);
}

export async function deletecontract(req, res) {
  const session = await mongoose.startSession(); session.startTransaction();
  try {
    const base = buildAccessFilter(req);
    const row = await Contract.findOne({ ...(base || {}), _id: req.params.id }).session(session);
    if (!row) return notFound(res);

    const current = currentKey(row);
    if (current === 'canceled') {
      return res.status(400).json({ error: 'Contrato cancelado não pode ser excluído' });
    }

    await row.deleteOne({ session });
    await eventQueue.add('sales.contract.deleted', {
      id: String(req.params.id),
      sequenceNumber: Number(row.sequenceNumber),
      contractNumber: Number.isFinite(row.sequenceNumber) ? pad8(row.sequenceNumber) : undefined,
    });
    await session.commitTransaction();

    // Notificação: excluído
    try {
      await notifier.notifyContractDeleted({ req, contract: row });
    } catch (e) {
      logger.warn('notify deleted falhou', { msg: e?.message });
    }

    return res.status(204).send();
  } catch (err) {
    await session.abortTransaction();
    logger.error('contract_delete_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  } finally { session.endSession(); }
}

// ====== GET BY NUMBER ======
export async function getcontractByNumber(req, res) {
  try {
    const numStr = String(req.params.number || '').trim();
    const seq = Number(numStr.replace(/^0+/, '') || '0');
    if (!Number.isFinite(seq) || seq < 0) return res.status(400).json({ error: 'Número inválido' });

    const filter = { ...(buildAccessFilter(req) || {}), sequenceNumber: seq };
    const rows = await Contract.find(filter).lean();

    if (!rows || rows.length === 0) return notFound(res);
    if (rows.length > 1) {
      return res.status(409).json({ error: 'ambiguous_contract_number', detail: { count: rows.length } });
    }
    return res.json(toResponse(rows[0]));
  } catch (err) {
    logger.error('contract_get_by_number_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  }
}