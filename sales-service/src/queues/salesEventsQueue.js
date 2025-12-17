/* === D:\SmartIASystems\sales-service\src\queues\salesEventsQueue.js === */
// Fila unificada: substitui eventQueue + salesEventsQueue
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import logger from '../config/logger.js';
import config from '../config/config.js';

const env = process.env.NODE_ENV || 'development';

const b = (v, fb) => {
  if (v === undefined || v === null) return fb;
  const s = String(v).toLowerCase();
  if (['true','1','yes','on'].includes(s)) return true;
  if (['false','0','no','off'].includes(s)) return false;
  return !!v;
};
const n = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

const qCfg = {
  enabled: b(config?.queue?.enabled ?? process.env.REDIS_QUEUE_ENABLED, true),
  // nome padrão preserva consumidores legados
  name: String(config?.queue?.name ?? process.env.REDIS_QUEUE_NAME_SALES ?? 'sales-events'),
  dlq: String(config?.queue?.dlq ?? process.env.REDIS_QUEUE_DLQ_PROPOSAL ?? 'sales-events.dlq'),
  attempts: n(config?.queue?.attempts ?? process.env.REDIS_QUEUE_ATTEMPTS, 5),
  backoffMs: n(config?.queue?.backoffMs ?? process.env.REDIS_QUEUE_BACKOFF_MS, 2000), // exponencial via helpers específicos
};

const rCfg = {
  url: config?.redis?.url ?? process.env.REDIS_URL ?? null,
  host: config?.redis?.host ?? process.env.REDIS_HOST ?? 'localhost',
  port: n(config?.redis?.port ?? process.env.REDIS_PORT, 6379),
  username: config?.redis?.username ?? process.env.REDIS_USERNAME ?? 'default',
  password: config?.redis?.password ?? process.env.REDIS_PASSWORD ?? undefined,
  prefix: config?.redis?.prefix ?? process.env.REDIS_PREFIX_SALES ?? 'sales',
  tls: b(config?.redis?.tls ?? process.env.REDIS_TLS, false),
  insecure: b(process.env.SKIP_TLS_VERIFY, env === 'development'),
};

let connection;
let queue;

function buildRedisConnection() {
  if (connection) return connection;

  if (rCfg.url) {
    const opts = { enableReadyCheck: true, lazyConnect: false };
    if (rCfg.url.startsWith('rediss://') || rCfg.tls) {
      opts.tls = { rejectUnauthorized: !rCfg.insecure };
    }
    connection = new IORedis(rCfg.url, opts);
  } else {
    const opts = {
      host: rCfg.host,
      port: rCfg.port,
      username: rCfg.username,
      password: rCfg.password,
      enableReadyCheck: true,
      lazyConnect: false,
    };
    if (rCfg.tls) opts.tls = { rejectUnauthorized: !rCfg.insecure };
    connection = new IORedis(opts);
  }

  connection.on('error', (err) => logger.error({ err: err?.message }, 'redis_connection_error'));
  connection.on('ready', () => logger.info('redis_connection_ready'));
  return connection;
}

export function getRedisConnection() {
  return connection;
}

function buildQueue() {
  if (queue || qCfg.enabled === false) return queue;
  const conn = buildRedisConnection();
  queue = new Queue(qCfg.name, {
    connection: conn,
    prefix: rCfg.prefix,
    defaultJobOptions: {
      attempts: qCfg.attempts,
      backoff: { type: 'exponential', delay: qCfg.backoffMs },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  queue.on('error', (err) => logger.error({ err: err?.message }, 'bullmq_queue_error'));
  return queue;
}

export const salesEventsQueue = {
  async add(eventName, payload = {}, opts = {}) {
    if (qCfg.enabled === false) return;
    const q = buildQueue();
    await q.add(
      eventName,
      { ...payload, eventName, ts: Date.now() },
      opts
    );
  },

  async toDLQ(reason, payload = {}) {
    if (qCfg.enabled === false) return;
    const q = buildQueue();
    try {
      await q.add(qCfg.dlq, { reason, payload, ts: Date.now() }, { attempts: 1, removeOnComplete: true, removeOnFail: true });
    } catch (e) {
      logger.error({ err: e?.message }, 'dlq_enqueue_error');
    }
  },

  async ping() {
    const conn = buildRedisConnection();
    return conn.ping();
  },
};

// Helpers específicos de domínio
export async function publishProposalCreated(payload) {
  await salesEventsQueue.add('sales.proposal.created', payload);
}

export async function publishProposalDeleted(payload) {
  await salesEventsQueue.add('sales.proposal.deleted', payload);
}

export async function publishStatusChanged(payload) {
  const jobId = `proposal:${payload.proposalId}:to:${payload.toStatus}`;
  await salesEventsQueue.add('sales.proposal.status_changed', payload, { jobId });
}

export async function dispatchNotification(payload) {
  await salesEventsQueue.add('notifications.dispatch', payload);
}

