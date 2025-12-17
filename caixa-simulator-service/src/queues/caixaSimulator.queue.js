// src/queues/caixaSimulatorQueue.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import axios from 'axios';
import https from 'https';
import logger from '../config/caixaSimulator.logger.js';
import mongoose from '../config/caixaSimulator.database.js';
import { caixaSimulator } from '../services/caixaSimulator.service.js';
import config from '../config/caixaSimulator.config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV = process.env.NODE_ENV || 'development';
//dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${ENV}`) });


// -------- Redis options unificadas (URL > vars soltas) --------
function buildRedisOptions() {
  const url = process.env.REDIS_URL;
  if (url) {
    const u = new URL(url);
    const isTLS = u.protocol === 'rediss:';
    return {
      host: u.hostname,
      port: Number(u.port || 6379),
      username: u.username || undefined,                 // ex.: "default"
      password: u.password || undefined,
      db: Number((u.pathname || '/0').slice(1)) || 0,
      tls: isTLS ? {} : undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    };
  }
  return {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    username: process.env.REDIS_USER || undefined,      // omita se não usar ACL
    password: process.env.REDIS_PASS || process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0) || 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

const QUEUE_NAME = process.env.QUEUE_NAME ?? 'simulator-caixa';
const REDIS_OPTS = buildRedisOptions();
const BULL_PREFIX = process.env.REDIS_PREFIX || 'bull';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Diagnóstico único (mesmas credenciais)
const diag = new IORedis(REDIS_OPTS);
diag.on('connect', () => logger.info(`redis.connect – ${REDIS_OPTS.host}:${REDIS_OPTS.port}/db${REDIS_OPTS.db ?? 0}`));
diag.on('ready',   () => logger.info('redis.ready – pronto'));
diag.on('error',   err => logger.error(`redis.error – ${err.message}`));
diag.on('close',   () => logger.warn('redis.close – fechado'));

// -------- Queue / Events (com auth aplicado) --------
export const caixaSimulatorQueue = new Queue(QUEUE_NAME, {
  connection: REDIS_OPTS,
  prefix: BULL_PREFIX,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});
logger.info(`queue.init – Fila '${QUEUE_NAME}' inicializada`);

const queueEvents = new QueueEvents(QUEUE_NAME, {
  connection: REDIS_OPTS,
  prefix: BULL_PREFIX,
});
queueEvents.on('waiting',   ({ jobId }) => logger.info(`queue.waiting – ${jobId}`));
queueEvents.on('active',    ({ jobId }) => logger.info(`queue.active – ${jobId}`));
queueEvents.on('completed', ({ jobId }) => logger.info(`queue.completed – ${jobId}`));
queueEvents.on('failed',    ({ jobId, failedReason }) => logger.error(`queue.failed – ${jobId}: ${failedReason}`));
queueEvents.on('error',     err => logger.error(`queue.error – ${err.message}`));

// -------- Worker (mesma conexão) --------
function startWorker() {
  logger.info('worker.start – Iniciando worker de simulações');

  const worker = new Worker(
    QUEUE_NAME,
    async job => {
      const start = Date.now();
      logger.info(`job.process.start – id=${job.id} payload=${JSON.stringify(job.data)}`);
      try {
        const result = await caixaSimulator(job.data);
        logger.info(`job.process.success – id=${job.id} durationMs=${Date.now() - start}`);
        // webhook disparado apenas dentro de caixaSimulator.service.js
        return result;
      } catch (e) {
        logger.error(`job.process.error – id=${job.id} durationMs=${Date.now() - start} error=${e.message}`);
        // webhook disparado apenas dentro de caixaSimulator.service.js
        throw e;
      }
    },
    {
      connection: REDIS_OPTS,
      prefix: BULL_PREFIX,
      concurrency: Number(process.env.WORKERS_SIMULTANEOS) || 1,
      lockDuration: 15 * 60_000,
      lockRenewTime: 7 * 60_000,
      maxStalledCount: 1,
      stalledInterval: 30_000,
    }
  );

  worker.on('error',     err => logger.error(`worker.error – ${err.message}`));
  worker.on('completed', job => logger.info(`worker.completed – ${job.id}`));
  worker.on('failed',    (job, err) => logger.error(`worker.jobFailed – ${job?.id} ${err.message}`));
  worker.on('drained',   () => logger.info('worker.drained – fila vazia'));
  worker.on('close',     () => logger.warn('worker.close – fechado'));
}

// -------- Mongo e bootstrap --------
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DATABASE = process.env.MONGO_DATABASE;
if (!MONGO_URI) {
  logger.error('mongodb.missingUri – MONGO_URI não definida');
} else {
  logger.info(`mongodb.connect – Conectando em ${MONGO_DATABASE}`);
  mongoose.connect(MONGO_URI).catch(err => logger.error(`mongodb.connectError – ${err.message}`));
}
mongoose.connection.on('connecting',   () => logger.info('mongodb.connecting – conectando...'));
mongoose.connection.on('connected',    () => { logger.info('mongodb.connected – conectado'); startWorker(); });
mongoose.connection.on('error',        err => logger.error(`mongodb.error – ${err.message}`));
mongoose.connection.on('disconnected', () => logger.warn('mongodb.disconnected – desconectado'));

if (mongoose.connection.readyState === 1) {
  logger.info('mongodb.hotstart – já conectado, iniciando worker');
  startWorker();
}

export default caixaSimulatorQueue;
