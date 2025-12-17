/* === D:\SmartIASystems\sales-service\src\controllers\proposalController.js === */
// Controller ajustado para usar apenas salesEventsQueue unificada
import mongoose from 'mongoose';
import axios from 'axios';
import https from 'https';
import ProposalStatus from '../models/proposalStatus.js';
import ProposalSequence from '../models/proposalSequence.js';
import Proposal from '../models/proposalModel.js';
import logger from '../config/logger.js';
import { withTxn } from '../db/transaction.js';
import {
  publishProposalCreated,
  publishProposalDeleted,
  publishStatusChanged,
  dispatchNotification,
} from '../queues/salesEventsQueue.js';

// ====== HTTP ======
const CONTACT_BASE = (process.env.APP_CONTACT_SERVICE_URL || '').replace(/\/+$/, '');
const PRODUCT_BASE = (process.env.APP_PRODUCT_SERVICE_URL || '').replace(/\/+$/, '');
const SELLER_BASE  = (process.env.APP_SELLER_SERVICE_URL  || '').replace(/\/+$/, '');
const REAL_ESTATE_BASE = (process.env.APP_REAL_ESTATE_SERVICE_URL || '').replace(/\/+$/, '');
// BASES externas (aceita APP_* também)
const BANK_CORRESPONDENT_BASE = (process.env.APP_BANK_CORRESPONDENT_SERVICE_URL
  || process.env.APP_APP_BANK_CORRESPONDENT_SERVICE_URL || '').replace(/\/+$/, '');
const AGENT_BASE = (process.env.APP_AGENT_SERVICE_URL || '').replace(/\/+$/, '');

// helpers simples
async function fetchContactName(id, headers) {
  try {
    const c = CONTACT_BASE ? await httpGet(`${CONTACT_BASE}/contacts/${id}`, headers) : null;
    return c?.name || c?.fullName || c?.displayName || '';
  } catch { return ''; }
}
async function fetchSellerName(id, headers) {
  try {
    const s = SELLER_BASE ? await httpGet(`${SELLER_BASE}/sellers/${id}`, headers) : null;
    return s?.name || s?.corporateName || s?.fantasyName || '';
  } catch { return ''; }
}
async function fetchProductInfo(id, headers) {
  try {
    const p = PRODUCT_BASE ? await httpGet(`${PRODUCT_BASE}/products/${id}`, headers) : null;
    return { code: p?.code, name: p?.name || p?.description };
  } catch { return {}; }
}
async function fetchName(url, headers) {
  try {
    const x = await httpGet(url, headers);
    return x?.name || x?.corporateName || x?.fantasyName || '';
  } catch { return ''; }
}

// monta TODO o contexto que o e-mail precisa (vale para qualquer status)
async function buildEmailContext(p, { toKey, fromKey }, req) {
  const headers = authHeader(req);

  const buyerNames  = await Promise.all((p.buyerId  || []).map(id => fetchContactName(id, headers)));
  const sellerNames = await Promise.all((p.sellerId || []).map(id => fetchSellerName(id, headers)));

  const productsDetailed = await Promise.all((p.products || []).map(async pr => {
    const info = await fetchProductInfo(pr.productId, headers);
    return {
      code: info.code, name: info.name, description: info.name,
      financingType: pr.financingType, purpose: pr.purpose,
      unitPrice: pr.unitPrice, clientHasProperty: pr.clientHasProperty,
      requestPortability: pr.requestPortability, authorizeLGPD: pr.authorizeLGPD,
      requestBankRelationship: pr.requestBankRelationship, useFGTS: pr.useFGTS,
      clientBenefitedFGTS: pr.clientBenefitedFGTS, moreBuyers: !!pr.coBuyer
    };
  }));

  const agentName = p.createdAtAgentId && AGENT_BASE
    ? await fetchName(`${AGENT_BASE}/agents/${p.createdAtAgentId}`, headers) : '';

  const realEstateName = p.createdAtRealEstateId && REAL_ESTATE_BASE
    ? await fetchName(`${REAL_ESTATE_BASE}/real-estates/${p.createdAtRealEstateId}`, headers) : '';

  // ► pega TODOS os campos do correspondente (code, name, address, e-mail, phone)
  let bankCorrespondent = null;
  if (p.createdAtBankCorrespondentId && BANK_CORRESPONDENT_BASE) {
    try {
      const bc = await httpGet(
        `${BANK_CORRESPONDENT_BASE}/bank-correspondents/${p.createdAtBankCorrespondentId}`,
        headers
      );
      bankCorrespondent = {
        code: bc?.code || '',
        name: bc?.name || '',
        address: bc?.address || '',
        contactEmail: bc?.contactEmail || '',
        contactPhone: bc?.contactPhone || ''
      };
    } catch {}
  }

  const toView   = await statusView(toKey);
  const fromView = fromKey ? await statusView(fromKey) : {};

  return {
    proposalId: String(p._id),
    sequenceNumber: p.sequenceNumber,
    proposalNumber: Number.isFinite(p.sequenceNumber) ? pad8(p.sequenceNumber) : undefined,
    fromStatus: fromKey, toStatus: toKey,
    statusPtBrFrom: fromView.statusPtBr, statusPtBrTo: toView.statusPtBr,
    statusDeadlineAt: p?.status?.[0]?.statusDeadlineAt,

    buyerNames:  buyerNames.filter(Boolean),
    sellerNames: sellerNames.filter(Boolean),
    productsDetailed,

    agentName, realEstateName,
    bankCorrespondent, // << objeto completo
    userName: req.user?.userName,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

async function fetchMaybe(url, headers) { try { return await httpGet(url, headers); } catch { return null; } }

async function fetchJsonSafe(url, headers) {
  try { return await httpGet(url, headers); } catch { return null; }
}
async function fetchBankCorrespondent(id, headers) {
  if (!BANK_CORRESPONDENT_BASE || !id) return null;
  const base = BANK_CORRESPONDENT_BASE.replace(/\/+$/, '');
  const paths = [
    `/bank-correspondents/${id}`,
    `/bank-correspondents/${id}`,
    `/bank-correspondent/${id}`
  ];
  for (const p of paths) {
    const d = await fetchJsonSafe(`${base}${p}`, headers);
    if (d && (d.code || d.name)) return d;
  }
  logger.warn('bc_lookup_failed', { id, base });
  return null;
}

// nomes/identificação
async function getAgentName(id, headers) {
  if (!id || !AGENT_BASE) return null;
  const d = await fetchMaybe(`${AGENT_BASE}/agents/${id}`, headers);
  return d?.name || d?.fullName || d?.nickname || id;
}
async function getRealEstateName(id, headers) {
  if (!id || !REAL_ESTATE_BASE) return null;
  const d = await fetchMaybe(`${REAL_ESTATE_BASE}/real-estates/${id}`, headers);
  return d?.tradeName || d?.legalName || d?.name || id;
}
async function getBCName(id, headers) {
  if (!id || !BANK_CORRESPONDENT_BASE) return null;
  const d = await fetchMaybe(`${BANK_CORRESPONDENT_BASE}/bank-correspondents/${id}`, headers);
  return d?.tradeName || d?.legalName || d?.name || id;
}

// compradores/vendedores com nome + documento
async function resolveActors({ req, buyerIds = [], sellerIds = [] }) {
  const headers = authHeader(req);
  const buyers = [];
  const sellers = [];

  for (const id of buyerIds) {
    const c = CONTACT_BASE ? await fetchMaybe(`${CONTACT_BASE}/contacts/${id}`, headers) : null;
    if (c) buyers.push({ id: String(id), name: c.fullName || c.name, documentNumber: c.documentNumber || c.taxId || c.document });
  }
  for (const id of sellerIds) {
    const s = SELLER_BASE ? await fetchMaybe(`${SELLER_BASE}/sellers/${id}`, headers) : null;
    if (s) sellers.push({ id: String(id), name: s.tradeName || s.legalName || s.name, documentNumber: s.documentNumber || s.taxId || s.document });
  }
  return { buyers, sellers };
}

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

const authHeader = (req) => {
  const raw = req.headers?.authorization || '';
  if (!raw) return {};
  return { Authorization: raw.startsWith('Bearer ') ? raw : `Bearer ${raw}` };
};
const unique = (arr) => Array.from(new Set((arr || []).filter(Boolean)));

const SYSTEMS = ['created','editing','under_analysis','analysis_completed','cancelled','finalized'];
const isSystem = (row) => row ? (row.type ? row.type === 'system' : !!row.isSystemic) : false;
const isActiveRow = (row) => row ? (row.status ? row.status === 'active' : !!row.isActive) : false;

// ====== Notificações ======
async function computeChannelsForStatus(keyLower) {
  const st = await ProposalStatus.findOne({ key: String(keyLower).toLowerCase() }).lean();
  const channels = { email: true, sms: false, push: false };
  if (st) {
    channels.email = st.sendEmail ?? channels.email;
    channels.sms   = st.sendSMS   ?? channels.sms;
    channels.push  = st.sendPush  ?? channels.push;
    if (!channels.email && !channels.sms && !channels.push) channels.email = true;
  }
  return channels;
}

async function resolveRecipients({ req, buyerIds = [], sellerIds = [] }) {
  const headers = authHeader(req);
  const emails = new Set();
  const phones = new Set();

  for (const id of buyerIds) {
    try {
      const c = CONTACT_BASE ? await httpGet(`${CONTACT_BASE}/contacts/${id}`, headers) : null;
      if (c?.email) emails.add(String(c.email).trim());
      if (c?.phoneNumber) phones.add(String(c.phoneNumber).trim());
    } catch {}
  }
  for (const id of sellerIds) {
    try {
      const s = SELLER_BASE ? await httpGet(`${SELLER_BASE}/sellers/${id}`, headers) : null;
      if (s?.email) emails.add(String(s.email).trim());
      if (s?.phoneNumber) phones.add(String(s.phoneNumber).trim());
    } catch {}
  }
  return { toEmails: Array.from(emails).filter(Boolean), toPhones: Array.from(phones).filter(Boolean) };
}

async function statusView(key) {
  const row = await ProposalStatus.findOne({ key: String(key).toLowerCase() }).lean();
  if (!row) return { statusPtBr: undefined, statusType: undefined, statusState: undefined, defaultDeadlineDays: 3, sendEmail: true, sendSMS: false, sendPush: false };
  return {
    statusPtBr: row.descriptionPtBr,
    statusType: isSystem(row) ? 'system' : 'custom',
    statusState: isActiveRow(row) ? 'active' : 'inactive',
    defaultDeadlineDays: Number(row.defaultDeadlineDays ?? 3),
    sendEmail: !!row.sendEmail, sendSMS: !!row.sendSMS, sendPush: !!row.sendPush,
  };
}
function currentKey(proposal) {
  const s0 = Array.isArray(proposal.status) && proposal.status[0] ? proposal.status[0] : null;
  return String(s0?.status || 'created').toLowerCase();
}

function ensureActive(obj) {
  // Valida se obj.status é string 'active' (padrão da API contacts, sellers, products)
  if (typeof obj?.status === 'string') {
    return obj.status.toLowerCase() === 'active';
  }
  
  // Fallback para outros formatos
  if (typeof obj?.isActive === 'boolean') return obj.isActive === true;
  
  // Array de status (usado em alguns modelos)
  if (Array.isArray(obj?.status)) {
    const s0 = obj.status[0];
    if (typeof s0 === 'string') return s0.toLowerCase() === 'active';
    if (s0 && typeof s0.status === 'string') return s0.status.toLowerCase() === 'active';
  }
  
  if (typeof obj?.statusState === 'string') return obj.statusState.toLowerCase() === 'active';
  
  return false;
}

async function validateBuyersProductsSellers({ req, buyerIds = [], products = [], sellerIds = [] }) {
  const missVars = [];
  if (!CONTACT_BASE) missVars.push('APP_CONTACT_SERVICE_URL');
  if (!PRODUCT_BASE) missVars.push('APP_PRODUCT_SERVICE_URL');
  if (!SELLER_BASE)  missVars.push('APP_SELLER_SERVICE_URL');
  if (missVars.length) { 
    logger.warn('Serviços externos não configurados, validação pulada', { missVars });
    return; // permite criar proposta sem validação externa
  }

  const headers = authHeader(req);

  // helper robusto: tenta /v1/ e sem /v1/
  const getContact = async (id) => {
    const paths = [
      `${CONTACT_BASE}/v1/contacts/${id}`,
      `${CONTACT_BASE}/contacts/${id}`
    ];
    for (const url of paths) {
      try { return await httpGet(url, headers); } catch (e) {
        if (e?.status && e.status !== 404) {
          // se não for 404, aborta tentativa para não mascarar erro real
          throw e;
        }
      }
    }
    // último fallback: lança 404
    const nf = new Error(`Contato ${id} não encontrado`); nf.status = 404; throw nf;
  };

  // Validação de buyers (pode ser lead ou client)
  for (const bid of buyerIds) {
    try {
      const contact = await getContact(bid);
      const type = String(contact?.type || '').toLowerCase();
      if (type !== 'client' && type !== 'lead') { 
        const e = new Error(`Buyer ${bid} precisa ser do tipo LEAD ou CLIENTE`); 
        e.status = 422; 
        throw e; 
      }
      /*const buyerStatus = String(contact?.status || '').toLowerCase();
      logger.debug('buyer_status_debug', { buyerId: bid, status: buyerStatus });
      if (buyerStatus !== 'active') { 
        const e = new Error(`Buyer ${bid} não está ativo`); 
        e.status = 422; 
        throw e; 
      }*/
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        logger.warn(`CONTACT_SERVICE indisponível, buyer ${bid} não validado`, { error: err.message });
        continue; // permite continuar se serviço estiver fora
      }
      throw err; // re-lança erros de negócio (422, 404, etc)
    }
  }

  // Validação de sellers (opcional)
  for (const sid of sellerIds || []) {
    try {
      const seller = await httpGet(`${SELLER_BASE}/sellers/${sid}`, headers);
      if (!ensureActive(seller)) { const e = new Error(`Seller ${sid} inativo`); e.status = 422; throw e; }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        logger.warn(`SELLER_SERVICE indisponível, seller ${sid} não validado`, { error: err.message });
        continue;
      }
      throw err;
    }
  }

  // Validação de produtos
  const productIds = unique((products || []).map(p => String(p?.productId || '')));
  if (!productIds.length) { const e = new Error('Lista de produtos inválida: productId ausente'); e.status = 400; throw e; }
  for (const pid of productIds) {
    try {
      const product = await httpGet(`${PRODUCT_BASE}/products/${pid}`, headers);
      if (!ensureActive(product)) { const e = new Error(`Produto ${pid} inativo`); e.status = 422; throw e; }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        logger.warn(`PRODUCT_SERVICE indisponível, produto ${pid} não validado`, { error: err.message });
        continue;
      }
      throw err;
    }
  }
}

// Validação específica para evolução de status (sair de 'created')
async function validateStatusEvolution({ req, proposal }) {
  const missVars = [];
  if (!CONTACT_BASE) missVars.push('APP_CONTACT_SERVICE_URL');
  if (!SELLER_BASE)  missVars.push('APP_SELLER_SERVICE_URL');
  if (missVars.length) {
    logger.warn('Serviços externos não configurados para validação de evolução de status', { missVars });
    return;
  }

  const headers = authHeader(req);
  const buyerIds = proposal.buyerId || [];
  const sellerIds = proposal.sellerId || [];

  // Validação 1: todos os buyerId devem ser do tipo 'client'
  for (const bid of buyerIds) {
    try {
      const contact = await httpGet(`${CONTACT_BASE}/contacts/${bid}`, headers);
      const type = String(contact?.type || '').toLowerCase();
      if (type !== 'client') {
        const e = new Error(`Para evoluir status, buyer ${bid} precisa ser do tipo CLIENT (atualmente: ${type})`);
        e.status = 422;
        throw e;
      }
      if (!ensureActive(contact)) {
        const e = new Error(`Buyer ${bid} está inativo`);
        e.status = 422;
        throw e;
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        logger.warn(`CONTACT_SERVICE indisponível ao validar evolução de status, buyer ${bid}`, { error: err.message });
        continue;
      }
      throw err;
    }
  }

  // Validação 2: sellerId é obrigatório e deve estar ativo
  if (!sellerIds || sellerIds.length === 0) {
    const e = new Error('Para evoluir status, sellerId é obrigatório');
    e.status = 422;
    throw e;
  }

  for (const sid of sellerIds) {
    try {
      const seller = await httpGet(`${SELLER_BASE}/sellers/${sid}`, headers);
      if (!ensureActive(seller)) {
        const e = new Error(`Para evoluir status, seller ${sid} precisa estar ativo`);
        e.status = 422;
        throw e;
      }
    } catch (err) {
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
        logger.warn(`SELLER_SERVICE indisponível ao validar evolução de status, seller ${sid}`, { error: err.message });
        continue;
      }
      throw err;
    }
  }
}

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

const notFound = (res) => res.status(404).json({ error: 'Proposta não encontrada' });

// src/controllers/proposalController.js

function toResponse(doc) {
  const d = doc?.toObject ? doc.toObject() : { ...doc };

  const {
    _id,
    sequenceNumber,              // mantenha no payload
    contractSequenceNumber,
    createdAtAgentId,
    createdAtRealEstateId,
    createdAtBankCorrespondentId,
    createdAt,
    updatedAt,
    auditInformation = [],
    ...rest
  } = d;

  // base do audit
  const audit = Array.isArray(auditInformation) && auditInformation.length ? [...auditInformation] : [{}];
  const ai0 = { ...(audit[0] || {}) };

  // sempre garantir datas
  if (!ai0.createdAt && createdAt) ai0.createdAt = createdAt;
  if (!ai0.updatedAt && updatedAt) ai0.updatedAt = updatedAt;

  // incluir IDs de origem no audit (somente na resposta)
  if (createdAtAgentId)            ai0.createdAtAgentId = createdAtAgentId;
  if (createdAtRealEstateId)       ai0.createdAtRealEstateId = createdAtRealEstateId;
  if (createdAtBankCorrespondentId)ai0.createdAtBankCorrespondentId = createdAtBankCorrespondentId;

  audit[0] = ai0;

  const pad8 = (n) => String(Number(n || 0)).padStart(8, '0');
  const proposalNumber = Number.isFinite(sequenceNumber) ? pad8(sequenceNumber) : undefined;
  const contractNumber = Number.isFinite(contractSequenceNumber) ? pad8(contractSequenceNumber) : undefined;

  return {
    _id,
    proposalNumber,
    contractSequenceNumber,
    contractNumber,
    ...rest,
    auditInformation: audit,
  };
}

// ====== CREATE ======
export async function createProposal(req, res) {
  const { buyerId, products } = req.body;
  let { sellerId } = req.body;
  
  // Garante que sellerId seja array (pode ser undefined ou null)
  if (!Array.isArray(sellerId)) {
    sellerId = [];
  }
  
  const missing = [];
  if (!Array.isArray(buyerId)  || buyerId.length === 0)  missing.push('buyerId');
  if (!Array.isArray(products) || products.length === 0) missing.push('products');
  if (missing.length) return res.status(400).json({ error: `Campos ausentes: ${missing.join(', ')}` });

  const session = await mongoose.startSession(); session.startTransaction();
  try {
    await validateBuyersProductsSellers({ req, buyerIds: buyerId, products, sellerIds: sellerId });

    // Log para debug
    logger.info('createProposal - Debug req.user e req.scope', {
      user: req.user,
      scope: req.scope
    });

    const createdByAuthId = String(req.user?.sub || '');
    const createdByUserName = String(req.user?.userName || '');
    const createdAtAgentId =
      Array.isArray(req?.scope?.agentIds) && req.scope.agentIds[0]
        ? String(req.scope.agentIds[0]) : undefined;

    let createdAtRealEstateId =
      (Array.isArray(req?.scope?.realEstateIds) && req.scope.realEstateIds[0])
        ? String(req.scope.realEstateIds[0])
        : undefined;

    let createdAtBankCorrespondentId =
      (Array.isArray(req?.scope?.ownerBcIds) && req.scope.ownerBcIds[0])
        ? String(req.scope.ownerBcIds[0])
        : undefined;
    if (!createdAtBankCorrespondentId && Array.isArray(req?.scope?.groupBcIds) && req.scope.groupBcIds[0]) {
      createdAtBankCorrespondentId = String(req.scope.groupBcIds[0]);
    }

    if (!createdAtBankCorrespondentId && createdAtRealEstateId && REAL_ESTATE_BASE) {
      try {
        const url = `${REAL_ESTATE_BASE}/real-estates/${createdAtRealEstateId}`;
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
        if (bc) {
          createdAtBankCorrespondentId = String(bc);
        }
      } catch (e) {
        logger.warn('falha ao obter RE p/ derivar BC', { msg: e?.message });
      }
    }

    if (!createdAtBankCorrespondentId) {
      await session.abortTransaction();
      logger.error('Bank correspondent não encontrado', {
        ownerBcIds: req?.scope?.ownerBcIds,
        groupBcIds: req?.scope?.groupBcIds,
        realEstateIds: req?.scope?.realEstateIds,
        agentIds: req?.scope?.agentIds,
        userSub: req.user?.sub,
        userName: req.user?.userName
      });
      return res.status(400).json({
        error: 'invalid_operation',
        detail: 'Usuário não possui bank-correspondent com ownerAuthId'
      });
    }

    // Log para verificar os valores antes de criar a proposta
    logger.info('createProposal - Valores antes de criar', {
      createdAtAgentId,
      createdAtRealEstateId,
      createdAtBankCorrespondentId
    });

    const view = await statusView('created');
    const days = Number(view.defaultDeadlineDays ?? 3);
    const now = new Date();

    const seqDoc = await ProposalSequence.findOneAndUpdate(
      { bankCorrespondentId: createdAtBankCorrespondentId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true, session }
    );
    const sequenceNumber = Number(seqDoc.seq);

    const [proposal] = await Proposal.create([{
      sequenceNumber,
      buyerId,
      sellerId,
      products,
      status: [{
        status: 'created',
        statusStartedAt: now,
        statusDeadlineAt: addDays(now, days),
        statusPtBr: view.statusPtBr,
        statusType: view.statusType,
        statusState: view.statusState,
        statusHistory: [{
          from: null, to: 'created', note: 'criação',
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

    // Eventos
    await publishProposalCreated({
      id: String(proposal._id),
      sequenceNumber,
      proposalNumber: pad8(sequenceNumber),
      createdByAuthId,
      createdAtAgentId,
      createdAtRealEstateId,
      createdAtBankCorrespondentId,
      buyerIds: buyerId.map(String),
      sellerIds: (sellerId || []).map(String),
    });

    // Notificação
    const recipients = await resolveRecipients({ req, buyerIds: buyerId, sellerIds: sellerId });
    const channels   = await computeChannelsForStatus('created');
    const ctx = await buildEmailContext(proposal, { toKey: 'created' }, req);

    await dispatchNotification({
      category: 'sales',
      event: 'proposal.created',
      proposalId: String(proposal._id),
      status: 'created',
      channels,
      recipients,
      to: recipients.toEmails,            // compat
      context: ctx,                       // <<< usar o contexto completo
    });

    await session.commitTransaction();
    return res.status(201).json(toResponse(proposal));
  } catch (err) {
    await session.abortTransaction();
    
    // Tratamento especial para AggregateError
    let errorMsg = err.message || err.toString() || 'Erro desconhecido';
    let errorDetail = err.detail || (err.response?.data ? JSON.stringify(err.response.data) : undefined);
    
    if (err.name === 'AggregateError' && Array.isArray(err.errors)) {
      const subErrors = err.errors.map(e => ({
        message: e.message || e.toString(),
        stack: e.stack,
        ...(e.response?.data && { responseData: e.response.data })
      }));
      errorMsg = `AggregateError: ${err.errors.length} erros`;
      errorDetail = JSON.stringify(subErrors, null, 2);
      logger.error('createProposal falhou (AggregateError)', { 
        error: errorMsg, 
        subErrors,
        stack: err.stack 
      });
    } else {
      logger.error('createProposal falhou', { 
        error: errorMsg, 
        detail: errorDetail, 
        stack: err.stack,
        name: err.name
      });
    }
    
    return res.status(err.status || 400).json({ error: errorMsg, detail: errorDetail });
  } finally { session.endSession(); }
}

// ====== LIST ======
export async function getProposals(req, res) {
  try {
    const filter = buildAccessFilter(req);
    const proposals = await Proposal.find(filter).lean();
    return res.json(proposals.map(toResponse));
  } catch (err) {
    logger.error('proposal_list_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  }
}

// GET /proposals/:id
export async function getProposalById(req, res) {
  try {
    const p = await Proposal.findById(req.params.id).lean();
    if (!p) return res.status(404).json({ message: 'Proposta não encontrada' });
    logger.info('proposal_get', { id: req.params.id });
    return res.json(p);
  } catch (err) {
    logger.error('proposal_get_error', { err: err.message, id: req.params.id });
    return res.status(500).json({ message: 'Erro interno' });
  }
}

// PUT/PATCH /proposals/:id
export async function updateProposal(req, res) {
  const { id } = req.params;
  const { status: toStatus, ...patch } = req.body || {};

  let updated = null;
  let fromStatus = null;

  try {
    updated = await withTxn(async (session) => {
      const p = await Proposal.findById(id).session(session);
      if (!p) { const e = new Error('Proposta não encontrada'); e.status = 404; throw e; }

      fromStatus = currentKey(p);

      // BLOQUEIO: não permitir mesmo status
      if (toStatus) {
        const key = String(toStatus).toLowerCase();
        if (key === fromStatus) {
          const e = new Error(`Status já é "${key}"`);
          e.status = 409; // Conflict
          throw e;
        }

        // VALIDAÇÃO: para evoluir de 'created' para outro status
        if (fromStatus === 'created' && key !== 'created') {
          await validateStatusEvolution({ req, proposal: p });
        }
      }

      // patch de campos não-status
      Object.entries(patch).forEach(([k, v]) => { if (k !== 'status') p[k] = v; });

      // empilha novo status se informado e diferente
      if (toStatus) {
        const key = String(toStatus).toLowerCase();
        const view = await statusView(key);
        const now = new Date();
        p.status.unshift({
          status: key,
          statusStartedAt: now,
          statusDeadlineAt: addDays(now, Number(view.defaultDeadlineDays ?? 3)),
          statusPtBr: view.statusPtBr,
          statusType: view.statusType,
          statusState: view.statusState,
          statusHistory: [{
            from: fromStatus,
            to: key,
            note: req.body?.statusChangeNote || 'mudança de status',
            changedByAuthId: String(req.user?.sub || ''),
            changedByUserName: String(req.user?.userName || ''),
            changedAt: now,
          }],
        });
      }

      await p.save({ session });
      return p.toObject();
    });

    // eventos + notificação quando houve troca real
    if (toStatus) {
      await publishStatusChanged({
        proposalId: String(updated._id),
        fromStatus,
        toStatus: String(toStatus).toLowerCase(),
        updatedAt: new Date().toISOString(),
      });

      const channels = await computeChannelsForStatus(String(toStatus).toLowerCase());
      const recipients = await resolveRecipients({ req, buyerIds: updated.buyerId, sellerIds: updated.sellerId });

      await dispatchNotification({
        category: 'sales',
        event: 'proposal.status_changed',
        proposalId: String(updated._id),
        status: String(toStatus).toLowerCase(),
        channels,
        recipients,
        to: recipients.toEmails, // compat
        context: {
          proposalNumber: Number.isFinite(updated.sequenceNumber) ? pad8(updated.sequenceNumber) : undefined,
          fromStatus,
          toStatus: String(toStatus).toLowerCase(),
        },
      });
    }

    return res.json(toResponse(updated));
  } catch (err) {
    const code = err.status || 500;
    logger[code >= 500 ? 'error' : 'warn']('proposal_update_error', { err: err.message, id });
    return res.status(code).json({ message: err.message });
  }
}


export async function approveProposal(req, res) {
  req.body = { ...(req.body || {}), status: 'approved', statusChangeNote: 'approve endpoint' };
  return updateProposal(req, res);
}

export async function deleteProposal(req, res) {
  const session = await mongoose.startSession(); session.startTransaction();
  try {
    const base = buildAccessFilter(req);
    const proposal = await Proposal.findOne({ ...(base || {}), _id: req.params.id }).session(session);
    if (!proposal) return notFound(res);

    const recipients = await resolveRecipients({ req, buyerIds: proposal.buyerId, sellerIds: proposal.sellerId });
    const seq = Number(proposal.sequenceNumber);

    await proposal.deleteOne({ session });

    await publishProposalDeleted({
      id: String(req.params.id),
      sequenceNumber: seq,
      proposalNumber: Number.isFinite(seq) ? pad8(seq) : undefined,
    });

    await dispatchNotification({
      category: 'sales',
      event: 'proposal.deleted',
      proposalId: String(req.params.id),
      proposalNumber: Number.isFinite(seq) ? pad8(seq) : undefined,
      status: 'deleted',
      channels: { email: true, sms: false, push: false },
      recipients,
      to: recipients.toEmails,
      context: {
        proposalNumber: Number.isFinite(seq) ? pad8(seq) : undefined,
        sequenceNumber: seq,
      },
    });


    await session.commitTransaction();
    return res.status(204).send();
  } catch (err) {
    await session.abortTransaction();
    logger.error('proposal_delete_error', { err: err.message });
    return res.status(500).json({ error: 'Erro interno' });
  } finally { session.endSession(); }
}

// Endpoints de atalho para status
const setStatusHandler = (targetKey) => async (req, res) => {
  const note = req.body?.note;
  const deadline = req.body?.statusDeadlineAt;
  req.body = { status: targetKey, statusChangeNote: note, statusDeadlineAt: deadline };
  return updateProposal(req, res);
};

export const setCreated        = setStatusHandler('created');
export const setEditing        = setStatusHandler('editing');
export const setUnderAnalysis  = setStatusHandler('under_analysis');
export const setAnalysisDone   = setStatusHandler('analysis_completed');
export const setCancelled      = setStatusHandler('cancelled');
export const setFinalized      = setStatusHandler('finalized');

// ====== LOOKUP BY PROPOSAL NUMBER ======
// Accepts padded string (00001234) or plain number; searches by sequenceNumber
export async function getProposalByNumber(req, res) {
  try {
    const raw = String(req.params.number || '').trim();
    const seq = Number(raw);
    const sequenceNumber = Number.isFinite(seq) ? seq : Number(raw.replace(/^0+/, ''));
    if (!Number.isFinite(sequenceNumber)) {
      return res.status(400).json({ error: 'Número de proposta inválido' });
    }
    const filter = { ...buildAccessFilter(req), sequenceNumber };
    const p = await Proposal.findOne(filter).lean();
    if (!p) return res.status(404).json({ error: 'Proposta não encontrada' });
    return res.json(toResponse(p));
  } catch (err) {
    logger.error('proposal_number_lookup_error', { err: err.message, number: req.params.number });
    return res.status(500).json({ error: 'Erro interno' });
  }
}

// ====== LOOKUP BY BUYER CPF ======
// Resolves Contact by CPF via external CONTACT service, then searches proposals by buyerId
async function resolveContactIdByCpf(cpf, headers) {
  const base = (process.env.APP_CONTACT_SERVICE_URL || '').replace(/\/+$/, '');
  if (!base) return null;
  const candidates = [
    `${base}/contacts/by-document/${cpf}`,
    `${base}/contacts/document/${cpf}`,
    `${base}/contacts?documentNumber=${encodeURIComponent(cpf)}`,
    `${base}/v1/contacts?documentNumber=${encodeURIComponent(cpf)}`,
  ];
  for (const url of candidates) {
    try {
      const data = await httpGet(url, headers);
      // handle either object or array responses
      if (Array.isArray(data) && data.length) {
        const id = data[0]?._id || data[0]?.id;
        if (id) return String(id);
      } else if (data && (data._id || data.id)) {
        return String(data._id || data.id);
      }
    } catch (e) {
      if (e?.status && e.status !== 404) throw e;
    }
  }
  return null;
}

export async function getProposalsByBuyerCpf(req, res) {
  try {
    const cpfRaw = String(req.query.cpf || '').replace(/[^0-9]/g, '');
    if (!cpfRaw || cpfRaw.length < 11) {
      return res.status(400).json({ error: 'CPF inválido' });
    }
    const headers = authHeader(req);
    const contactId = await resolveContactIdByCpf(cpfRaw, headers);
    if (!contactId) {
      return res.status(404).json({ error: 'Comprador não encontrado para CPF informado' });
    }
    const filter = { ...buildAccessFilter(req), buyerId: { $in: [contactId] } };
    const rows = await Proposal.find(filter).lean();
    return res.json(rows.map(toResponse));
  } catch (err) {
    logger.error('proposal_buyer_cpf_lookup_error', { err: err.message, cpf: req.query?.cpf });
    const code = err.status || 500;
    return res.status(code).json({ error: err.message || 'Erro interno' });
  }
}
