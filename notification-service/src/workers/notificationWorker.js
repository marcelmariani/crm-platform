/* === D:\SmartIASystems\notification-service\src\workers\notificationWorker.js === */
import { Worker } from 'bullmq';
import config from '../config/config.js';
import '../config/database.js';
import Notification from '../models/notificationModel.js';
import logger from '../config/logger.js';
import { sendEmail } from '../providers/email/nodemailerProvider.js';
import { renderContractEmail, renderGenericEmail } from '../templates/contractStatusTemplates.js';
import axios from 'axios';
import https from 'https';

// -------------------- helpers de URL/ENV --------------------
const stripV1 = (u) => String(u || '').replace(/\/+$/,'').replace(/\/v1$/,'');
const joinV1  = (base, path) => `${stripV1(base)}/v1${path}`;

// -------------------- Event gates --------------------
const STATIC_EVENTS = new Set([
  'notifications.dispatch',
  'ContractStatusChanged', // legado
]);

// -------------------- HTTP + Auth --------------------
const httpsAgent = new https.Agent({
  rejectUnauthorized: !(process.env.NODE_ENV === 'development' || process.env.SKIP_TLS_VERIFY === 'true'),
});

const CONTRACT_BASE    = stripV1(process.env.CONTRACT_SERVICE_URL || process.env.CONTRACT_SERVICE_BASE_URL || config.services?.contractServiceBaseUrl || '');
const BANK_CORR_BASE   = stripV1(process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || config.services?.bankCorrespondentBaseUrl || process.env.BANK_CORRESPONDENT_SERVICE_URL || '');
const REAL_ESTATE_BASE = stripV1(process.env.APP_REAL_ESTATE_SERVICE_URL || config.services?.realEstateBaseUrl || process.env.REAL_ESTATE_SERVICE_URL || '');
const AGENT_BASE       = stripV1(process.env.APP_AGENT_SERVICE_URL || config.services?.agentBaseUrl || process.env.AGENT_SERVICE_URL || '');

const AUTH_BASE  = (config.services?.authBaseUrl || process.env.JWT_SERVICE_URL || '').replace(/\/+$/,'');
const AUTH_LOGIN = (config.services?.authLoginPath || process.env.JWT_LOGIN_PATH || '/v1/auth/login');
const AUTH_USER  = process.env.JWT_ADMIN_USERNAME || '';
const AUTH_PASS  = process.env.JWT_ADMIN_PASS || '';
const FALLBACK_TO = (process.env.NOTIFICATIONS_FALLBACK_TO || '').trim();

let authCache = { token: null, exp: 0 };

// --------- util: montar cURL de debug (Authorization NÃO mascarado) ----------
function buildCurl({ method = 'GET', url, headers = {}, body }) {
  const parts = [`curl -k -sS -X ${method.toUpperCase()} "${url}"`];
  const hdrs = { Accept: 'application/json', ...headers };
  for (const [k, v] of Object.entries(hdrs)) {
    parts.push(`-H "${k}: ${v}"`); // loga token completo
  }
  if (body != null) {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    parts.push(`--data '${data}'`);
  }
  return parts.join(' ');
}

// -------------------- Auth --------------------
async function getAdminToken() {
  const now = Date.now();
  if (authCache.token && authCache.exp > now + 15_000) return authCache.token;
  if (!AUTH_BASE || !AUTH_USER || !AUTH_PASS) {
    logger.warn('auth_disabled', { AUTH_BASE: !!AUTH_BASE, AUTH_USER: !!AUTH_USER });
    return null;
  }
  try {
    const url = `${AUTH_BASE}${AUTH_LOGIN}`;
    logger.debug('auth_login_req', { url, user: AUTH_USER });
    const r = await axios.post(url, { userName: AUTH_USER, password: AUTH_PASS }, { httpsAgent, timeout: 8000 });
    const token = r.data?.token || r.data?.access_token || r.data?.jwt;
    if (!token) throw new Error('token ausente');
    authCache = { token, exp: now + 55 * 60 * 1000 };
    logger.debug('auth_login_ok');
    return token;
  } catch (e) {
    logger.warn('auth_login_fail', { msg: e?.message });
    return null;
  }
}

// -------------------- HTTP GET com cURL no log --------------------
async function safeGet(label, url, headers = {}) {
  const finalHeaders = { Accept: 'application/json', ...headers };
  const curl = buildCurl({ method: 'GET', url, headers: finalHeaders });
  logger.debug(`${label}_curl`, { curl });

  try {
    logger.debug(`${label}_req`, { url, hasAuth: !!finalHeaders.Authorization });
    const r = await axios.get(url, {
      httpsAgent,
      timeout: 8000,
      validateStatus: () => true,
      headers: finalHeaders,
    });
    const { status } = r;
    if (status >= 200 && status < 300) {
      logger.debug(`${label}_ok`, { status });
      return r.data;
    }
    if (status === 404) { logger.warn(`${label}_404`, { url }); return null; }
    if (status === 401 || status === 403) { logger.warn(`${label}_auth_fail`, { url, status }); return null; }
    if (status >= 500) { logger.warn(`${label}_5xx`, { url, status }); return null; }
    logger.warn(`${label}_fail`, { url, status });
    return null;
  } catch (e) {
    logger.warn(`${label}_err`, { url, msg: e?.message });
    return null;
  }
}

async function safeGetAuth(label, url) {
  const token = await getAdminToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return safeGet(label, url, headers);
}

// -------------------- utils/status --------------------
const normalizeStatusKey = s => String(s || '').trim().toLowerCase();
const isContractEvent = (name) => {
  const n = String(name || '').toLowerCase();
  return n.startsWith('contract.') || n.startsWith('contracts.') || n.startsWith('sales.contract.');
};
const ends = (name, suffix) => String(name || '').toLowerCase().endsWith(suffix);
const isContractCreated       = (n) => isContractEvent(n) && ends(n, '.created');
const isContractStatusChanged = (n) => isContractEvent(n) && ends(n, '.status_changed');

function deriveStatusesFromContract(c = {}) {
  const direct = c.currentStatus || c.status || c.state;
  const pools = [
    ...(Array.isArray(c.statusHistory) ? c.statusHistory : []),
    ...(Array.isArray(c.statuses) ? c.statuses : []),
    ...(Array.isArray(c.lifecycle?.history) ? c.lifecycle.history : []),
    ...(Array.isArray(c.status) ? c.status : []),
  ];
  const timeline = pools.map(it => {
    const key = it?.status ?? it?.key ?? it?.code ?? it?.state ?? it?.name ?? it?.value;
    const at  = it?.changedAt ?? it?.updatedAt ?? it?.createdAt ?? it?.at ?? it?.date ?? c.updatedAt ?? c.createdAt ?? null;
    return { key: normalizeStatusKey(key), at: at ? new Date(at).getTime() : 0 };
  }).filter(x => x.key);

  if (timeline.length) {
    timeline.sort((a,b)=>a.at-b.at);
    const last = timeline[timeline.length-1]?.key || null;
    const prev = timeline.length>1 ? timeline[timeline.length-2]?.key : null;
    return { current: last, previous: prev };
  }
  if (direct) return { current: normalizeStatusKey(direct), previous: null };
  return { current: null, previous: null };
}

// -------------------- Fetch/Hydrate --------------------
async function fetchContractAny({ contractId, contractNumber }) {
  if (!CONTRACT_BASE) return null;
  const tries = [];
  if (contractId) tries.push(joinV1(CONTRACT_BASE, `/contracts/${encodeURIComponent(contractId)}`));
  if (contractNumber) {
    tries.push(joinV1(CONTRACT_BASE, `/contracts/by-number/${encodeURIComponent(contractNumber)}`));
    tries.push(joinV1(CONTRACT_BASE, `/contracts?contractNumber=${encodeURIComponent(contractNumber)}`));
    try { tries.push(joinV1(CONTRACT_BASE, `/contracts?number=${encodeURIComponent(contractNumber)}`)); } catch {}
  }
  for (const url of tries) {
    const c = await safeGetAuth('contract', url);
    if (c && typeof c === 'object') return Array.isArray(c) ? c[0] : c;
  }
  return null;
}

async function hydrateEmailCtx(base) {
  const ctx = { ...base };

  if (ctx.contract && typeof ctx.contract === 'object') {
    ctx.contractId = ctx.contractId || ctx.contract.id || ctx.contract._id;
    ctx.contractNumber = ctx.contractNumber || ctx.contract.contractNumber || ctx.contract.number || ctx.contract.sequenceNumber;
    ctx.proposalNumber = ctx.proposalNumber || ctx.contract.proposalNumber || ctx.contract.proposalSequenceNumber;

    ctx.createdAtBankCorrespondentId =
      ctx.createdAtBankCorrespondentId ||
      ctx.contract.createdAtBankCorrespondentId ||
      ctx.contract.bankCorrespondentId ||
      ctx.contract.bankCorrespondent?.id;

    ctx.createdAtRealEstateId =
      ctx.createdAtRealEstateId ||
      ctx.contract.createdAtRealEstateId ||
      ctx.contract.realEstateId ||
      ctx.contract.realEstate?.id;

    ctx.createdAtAgentId =
      ctx.createdAtAgentId ||
      ctx.contract.createdAtAgentId ||
      ctx.contract.agentId ||
      ctx.contract.agent?.id;

    const auditC = Array.isArray(ctx.contract.auditInformation) ? ctx.contract.auditInformation[0] : undefined;
    if (auditC) {
      ctx.createdAtBankCorrespondentId = ctx.createdAtBankCorrespondentId || auditC.createdAtBankCorrespondentId;
      ctx.createdAtRealEstateId        = ctx.createdAtRealEstateId        || auditC.createdAtRealEstateId;
      ctx.createdAtAgentId             = ctx.createdAtAgentId             || auditC.createdAtAgentId;
    }
  }

  if (!ctx.contract && (ctx.contractId || ctx.contractNumber)) {
    const c = await fetchContractAny({ contractId: ctx.contractId, contractNumber: ctx.contractNumber });
    if (c) ctx.contract = c;
  }

  if (ctx.contract) {
    const { current, previous } = deriveStatusesFromContract(ctx.contract);
    if (!ctx.toStatus && current) ctx.toStatus = current;
    if (!ctx.fromStatus && previous) ctx.fromStatus = previous;

    ctx.contractId = ctx.contractId ?? ctx.contract.id ?? ctx.contract._id;
    ctx.contractNumber = ctx.contractNumber ?? ctx.contract.contractNumber ?? ctx.contract.number ?? ctx.contract.sequenceNumber;
    ctx.proposalNumber = ctx.proposalNumber ?? ctx.contract.proposalNumber ?? ctx.contract.proposalSequenceNumber;

    const auditC = Array.isArray(ctx.contract.auditInformation) ? ctx.contract.auditInformation[0] : undefined;
    if (auditC) {
      ctx.createdAtBankCorrespondentId = ctx.createdAtBankCorrespondentId || auditC.createdAtBankCorrespondentId;
      ctx.createdAtRealEstateId        = ctx.createdAtRealEstateId        || auditC.createdAtRealEstateId;
      ctx.createdAtAgentId             = ctx.createdAtAgentId             || auditC.createdAtAgentId;
    }
  }

  const auditP = Array.isArray(ctx.auditInformation) ? ctx.auditInformation[0] : undefined;
  if (auditP) {
    ctx.createdAtBankCorrespondentId = ctx.createdAtBankCorrespondentId || auditP.createdAtBankCorrespondentId;
    ctx.createdAtRealEstateId        = ctx.createdAtRealEstateId        || auditP.createdAtRealEstateId;
    ctx.createdAtAgentId             = ctx.createdAtAgentId             || auditP.createdAtAgentId;
  }

  logger.debug('arb_ids', {
    contractNumber: ctx.contractNumber || null,
    agentId: ctx.createdAtAgentId || null,
    realEstateId: ctx.createdAtRealEstateId || null,
    bankCorrespondentId: ctx.createdAtBankCorrespondentId || null,
  });

  return ctx;
}

// -------------------- Recipients (Agent, RealEstate, BankCorrespondent) --------------------
function pickEmail(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const candidates = [
    obj.email,
    obj.contactEmail,
    obj.notificationEmail,
    Array.isArray(obj.emails) ? obj.emails.find(e => !!e) : null,
    Array.isArray(obj.contacts) ? (obj.contacts.find(c => c?.email)?.email) : null,
  ].filter(Boolean);
  return candidates.length ? String(candidates[0]).trim() : null;
}

async function fetchEmail(urlBase, label, id) {
  const token = await getAdminToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  const url = `${urlBase}/${encodeURIComponent(id)}`;
  const data = await safeGet(label, url, headers);
  const email = pickEmail(data);
  if (email) logger.debug(`${label}_email_hit`, { url, email });
  return email;
}

async function resolveRecipientsARB(ctx) {
  const emails = new Set();

  if (ctx.createdAtAgentId && AGENT_BASE) {
    const email = await fetchEmail(joinV1(AGENT_BASE, '/agents'), 'agent_api', ctx.createdAtAgentId);
    if (email) emails.add(email);
  }

  if (ctx.createdAtRealEstateId && REAL_ESTATE_BASE) {
    const email = await fetchEmail(joinV1(REAL_ESTATE_BASE, '/real-estates'), 'real_estate_api', ctx.createdAtRealEstateId);
    if (email) emails.add(email);
  }

  if (ctx.createdAtBankCorrespondentId && BANK_CORR_BASE) {
    const email = await fetchEmail(joinV1(BANK_CORR_BASE, '/bank-correspondents'), 'bank_corr_api', ctx.createdAtBankCorrespondentId);
    if (email) emails.add(email);
  }

  const out = Array.from(emails).filter(Boolean);
  logger.debug('arb_recipients', { count: out.length, to: out });
  return out;
}

// -------------------- Redis conn --------------------
function parseRedisUrl(url) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 6379,
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname && u.pathname !== '/' ? parseInt(u.pathname.slice(1), 10) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
function buildRedisConn() {
  if (config.redis?.url) return parseRedisUrl(config.redis.url);
  return {
    host: config.redis?.host || '127.0.0.1',
    port: config.redis?.port ? parseInt(config.redis.port, 10) : 6379,
    username: config.redis?.username || undefined,
    password: config.redis?.password || undefined,
    tls: String(config.redis?.tls || '').toLowerCase() === 'true' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}

// -------------------- Processor --------------------
async function processJob(job) {
  const { name: eventName, data } = job;

  const handle =
    STATIC_EVENTS.has(eventName) ||
    isContractCreated(eventName) ||
    isContractStatusChanged(eventName) ||
    String(eventName || '').toLowerCase().startsWith('notify.');

  if (!handle) {
    await Notification.create({ event: eventName, payload: data, status: 'pending' });
    logger.info('ignored_event', { eventName });
    return;
  }

  const notif = await Notification.create({ event: eventName, payload: data, status: 'pending' });

  try {
    const isDispatch = eventName === 'notifications.dispatch';

    const basePayload =
      data?.payload !== undefined ? data.payload : (data?.context !== undefined ? data.context : data || {});

    const inferred = isContractCreated(eventName) ? 'created' : null;

    const payload = await hydrateEmailCtx({
      ...basePayload,
      __event: eventName,
      ...(basePayload?.toStatus || basePayload?.status ? {} : (inferred ? { toStatus: inferred } : {})),
    });

    const toKey = normalizeStatusKey(payload.toStatus);
    const fromKey = normalizeStatusKey(payload.fromStatus);
    if (isContractStatusChanged(eventName) && toKey && toKey === fromKey) {
      logger.info('skip_same_status', { eventName, toStatus: payload.toStatus, fromStatus: payload.fromStatus });
      await notif.save();
      return;
    }

    // Render
    const rendered = (isContractEvent(eventName) || payload.contractId || payload.contractNumber)
      ? renderContractEmail(payload)
      : renderGenericEmail(eventName, payload);

    // Destinatários: agent + real-estate + bank-correspondent (1 cópia)
    let to = await resolveRecipientsARB(payload);
    if (!to.length && FALLBACK_TO) {
      to = [FALLBACK_TO];
      logger.info('using_fallback_recipient', { to });
    }
    if (!to.length && isDispatch) throw new Error('Destinatários ausentes');
    if (!to.length && !isDispatch) {
      logger.info('skip_email_no_recipients', { eventName });
      await notif.save();
      return;
    }

    await sendEmail({ to, subject: rendered.subject, text: rendered.text, html: rendered.html });

    notif.status = 'sent';
    notif.sentAt = new Date();
    await notif.save();

    logger.info('email_sent', { eventName, to, toStatus: payload.toStatus, fromStatus: payload.fromStatus });
  } catch (err) {
    notif.status = 'failed';
    await notif.save();
    logger.error('email_failed', { id: notif._id, err: err?.message });
    throw err;
  }
}

// -------------------- Multi-queue Workers --------------------
const connection = buildRedisConn();
const Q_PREFIX = process.env.REDIS_PREFIX_SALES || 'sales';

const queueNames = (process.env.QUEUE_NAMES || process.env.QUEUE_NAME || 'sales-events')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const workers = queueNames.map(qName => {
  const w = new Worker(qName, processJob, { connection, prefix: Q_PREFIX, concurrency: 5 });

  w.on('ready', () => logger.info('worker_ready', { queue: qName, redis: `${connection.host}:${connection.port}`, db: connection.db ?? 0 }));
  w.on('error', err => logger.error('worker_error', { queue: qName, err: err?.message }));
  w.on('active', job => logger.info('job_active', { queue: qName, id: job.id, name: job.name }));
  w.on('completed', job => logger.info('job_completed', { queue: qName, id: job.id }));
  w.on('failed', (job, err) => logger.error('job_failed', { queue: qName, id: job?.id, err: err?.message }));

  return w;
});

export default workers;
