// src/queues/notificationPublisher.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';
import config from '../config/config.js';
import eventQueue from '../queues/eventQueue.js';

const BASE = String(process.env.NOTIFICATION_SERVICE_URL || config?.services?.notificationBaseUrl || '').replace(/\/+$/, '');
const EVENT_PATH = String(process.env.SERVICES_NOTIFICATION_EVENT_PATH || config?.services?.notificationEventPath || '/v1/notifications/events');
const CREATE_PATH = String(process.env.SERVICES_NOTIFICATION_CREATE_PATH || config?.services?.notificationCreatePath || '/v1/notifications');
const PREFER_EVENT_ENDPOINT = String(process.env.SERVICES_NOTIFICATION_PREFER_EVENT || config?.services?.notificationPreferEvent || 'true').toLowerCase() !== 'false';

const httpsAgent = new https.Agent({
  rejectUnauthorized: !(config.env === 'development' || config.skipTlsVerify),
});

// Erros transitórios comuns de rede. Tratados como WARN + throttle.
const TRANSIENT_CODES = new Set(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN']);

// Throttle de logs para evitar spam quando o serviço estiver offline.
const _lastLogAt = new Map(); // key -> timestamp
const LOG_WINDOW_MS = Number(process.env.NOTIFICATION_LOG_WINDOW_MS || 60000);

function logOnce(level, msg, meta = {}, key) {
  const k = key || msg;
  const now = Date.now();
  const last = _lastLogAt.get(k) || 0;
  if (now - last < LOG_WINDOW_MS) return;
  _lastLogAt.set(k, now);
  // Passa meta como objeto único para não poluir com [Symbol(...)]
  logger[level]({ msg, ...meta });
}

function bearer(req) {
  const h = req?.headers?.authorization?.trim();
  if (!h) return {};
  return { Authorization: h.startsWith('Bearer ') ? h : `Bearer ${h}` };
}

function normalizeError(err) {
  const status = err?.response?.status ?? err?.status;
  const data = err?.response?.data ?? err?.detail;
  const url = err?.config?.url || err?.request?.path;
  const code = err?.code;
  const message =
    (data && (data.message || data.error || data.detail)) ||
    err?.message ||
    code ||
    'notification error';
  return { message: String(message), status, code, url, data };
}

async function postJSON(path, data, req) {
  if (!BASE) throw new Error('NOTIFICATION_SERVICE_URL não configurado');
  const url = `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json', ...bearer(req) };
  const res = await axios.post(url, data, {
    headers,
    httpsAgent,
    timeout: 8000,
    validateStatus: (s) => s >= 200 && s < 500,
  });
  //logger.info({ notificationBaseUrl: BASE }, 'notification target');
  if (res.status >= 400) {
    const e = new Error(res.data?.message || `notification-service HTTP ${res.status}`);
    e.status = res.status;
    e.detail = res.data;
    e.config = { url };
    throw e;
  }
  return res.data;
}

function recipientsFromContract(doc = {}) {
  const ai0 = Array.isArray(doc.auditInformation) ? doc.auditInformation[0] : {};
  return {
    authIds: [ai0?.createdByAuthId].filter(Boolean),
    contactIds: [
      ...(Array.isArray(doc.buyerId) ? doc.buyerId : []),
      ...(Array.isArray(doc.sellerId) ? doc.sellerId : []),
    ].map(String),
    realEstateIds: [doc.createdAtRealEstateId].filter(Boolean).map(String),
    bankCorrespondentIds: [doc.createdAtBankCorrespondentId].filter(Boolean).map(String),
  };
}

function compactContractView(doc = {}) {
  const s0 = Array.isArray(doc.status) && doc.status[0] ? doc.status[0] : {};
  return {
    id: String(doc._id || ''),
    sequenceNumber: Number.isFinite(doc.sequenceNumber) ? Number(doc.sequenceNumber) : undefined,
    contractNumber: doc.contractNumber || undefined,
    proposalSequenceNumber: Number.isFinite(doc.proposalSequenceNumber) ? Number(doc.proposalSequenceNumber) : undefined,
    proposalNumber: doc.proposalNumber || undefined,
    status: s0.status,
    statusPtBr: s0.statusPtBr,
    statusStartedAt: s0.statusStartedAt,
    statusDeadlineAt: s0.statusDeadlineAt,
    createdAtAgentId: doc.createdAtAgentId || undefined,
    createdAtRealEstateId: doc.createdAtRealEstateId || undefined,
    createdAtBankCorrespondentId: doc.createdAtBankCorrespondentId || undefined,
  };
}

function titleFor(type, doc, extra = {}) {
  const num = doc?.contractNumber ? `#${doc.contractNumber}` : '';
  switch (type) {
    case 'contract.created': return `Contrato ${num} criado`;
    case 'contract.updated': return `Contrato ${num} atualizado`;
    case 'contract.status_changed': return `Contrato ${num} → ${String(extra?.to || '').toUpperCase()}`;
    case 'contract.deleted': return `Contrato ${num} excluído`;
    default: return `Contrato ${num} evento`;
  }
}

async function httpOrEnqueue(eventName, payload, req) {
  if (BASE) {
    try {
      const path = PREFER_EVENT_ENDPOINT ? EVENT_PATH : CREATE_PATH;
      const body = PREFER_EVENT_ENDPOINT
        ? { type: eventName, source: 'contract-service', payload }
        : {
            title: titleFor(eventName, payload?.contract, payload),
            message: payload?.message || undefined,
            channelHints: payload?.channelHints || ['push', 'email'],
            recipients: payload?.recipients || {},
            data: payload,
          };
      return await postJSON(path, body, req);
    } catch (err) {
      const ne = normalizeError(err);
      const key = `${ne.code || 'HTTP'}::${ne.url || 'unknown'}`;
      if (TRANSIENT_CODES.has(ne.code)) {
        logOnce('warn', 'notification-service indisponível, fallback para fila', ne, key);
      } else {
        logOnce('error', 'notification-service falhou, enviando para DLQ', ne, key);
      }
      try {
        await eventQueue.toDLQ('notification_http_failed', { eventName, payload, ...ne });
      } catch (e) {
        logOnce('error', 'DLQ enqueue falhou para notification', normalizeError(e), 'DLQ::notification');
      }
    }
  } else {
    logOnce('warn', 'NOTIFICATION_SERVICE_URL ausente. usando apenas fila interna');
  }

  try {
    await eventQueue.add(`notify.${eventName}`, payload, { removeOnFail: false });
  } catch (e) {
    logOnce('error', 'enqueue notify fallback falhou', normalizeError(e), 'enqueue::notify');
  }
}

export async function notifyContractCreated({ req, contract }) {
  const payload = {
    recipients: recipientsFromContract(contract),
    contract: compactContractView(contract),
    meta: { ts: Date.now() },
  };
  return httpOrEnqueue('contract.created', payload, req);
}

export async function notifyContractUpdated({ req, contract }) {
  const payload = {
    recipients: recipientsFromContract(contract),
    contract: compactContractView(contract),
    meta: { ts: Date.now() },
  };
  return httpOrEnqueue('contract.updated', payload, req);
}

export async function notifyStatusChanged({ req, contract, from, to, deadlineAt }) {
  const payload = {
    recipients: recipientsFromContract(contract),
    contract: compactContractView(contract),
    from, to,
    deadlineAt,
    meta: { ts: Date.now() },
  };
  return httpOrEnqueue('contract.status_changed', payload, req);
}

export async function notifyContractDeleted({ req, contract }) {
  const payload = {
    recipients: recipientsFromContract(contract),
    contract: compactContractView(contract),
    meta: { ts: Date.now() },
  };
  return httpOrEnqueue('contract.deleted', payload, req);
}
