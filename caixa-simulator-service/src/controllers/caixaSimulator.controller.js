// src/controllers/caixaSimulator.controller.js
import queue from '../queues/caixaSimulator.queue.js';
import SimulatorCaixa from '../models/caixaSimulator.model.js';
import logger from '../config/caixaSimulator.logger.js';
import { Types } from 'mongoose';

/* Helpers */
const ms  = v => (Number.isFinite(v) && v > 0 ? v : undefined);
const iso = v => (v ? new Date(v).toISOString() : undefined);
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in (o || {})).map(k => [k, o[k]]));

const maskCpf   = s => (s ? String(s).replace(/\D/g,'').replace(/^(\d{3})\d{5}(\d{3}).*$/, '$1*****$2') : s);
const maskPhone = s => (s ? String(s).replace(/\D/g,'').replace(/^(\d{2})\d{5}(\d{4}).*$/, '($1) *****-$2') : s);
function maskInput(data = {}) {
  const b = { ...data };
  if ('cpf' in b) b.cpf = maskCpf(b.cpf);
  if ('telefone' in b) b.telefone = maskPhone(b.telefone);
  if ('dataNascimento' in b) b.dataNascimento = '****-**-**';
  return b;
}

export async function createJob(req, res, next) {
  try {
    logger.info('Recebida requisição de simulação');

    // gera (ou usa) o _id da simulação e injeta no payload do job
    // Se a chamada original forneceu `whatsappSimulationId`, sempre usamo-lo tal como veio.
    const whatsappSimulationId = req.body?.whatsappSimulationId;
    
    // Valida se é um ObjectId válido
    if (!whatsappSimulationId || !Types.ObjectId.isValid(whatsappSimulationId)) {
      logger.warn('whatsappSimulationId inválido ou não fornecido');
      return //res.status(400).json({ error: 'whatsappSimulationId inválido ou não fornecido' });
    }

    const payload = { ...req.body} //, simulationId };

    // Use the simulationId as the jobId to make enqueuing idempotent.
    // If a job with the same simulationId already exists, return its info
    // instead of creating a duplicate.
    const existing = await queue.getJob(whatsappSimulationId);
    if (existing) {
      const state = await existing.getState();
      logger.info(`Request reused existing job id=${existing.id} state=${state}`);
      return res.status(200).json({
        jobId: existing.id,
        whatsappSimulationId,
        status: state === 'completed' ? 'completed' : 'queued',
        reused: true,
      });
    }

    const job = await queue.add('simulator.caixa', payload, {
      removeOnComplete: false,
      removeOnFail: false,
    });

    return res.status(202).json({
      jobId: job.id,
      whatsappSimulationId,
      status: 'queued',
      reused: false,
    });
  } catch (err) {
    logger.error(`Erro ao enfileirar simulação: ${err.message}`);
    next(err);
  }
}

export async function getJob(req, res) {
  const jobId = req.params.jobId;
  const v = Math.max(0, Math.min(3, Number(req.query.verbose ?? 1)));

  const job = await queue.getJob(jobId);
  if (!job) return res.status(404).json({ message: 'Job não encontrado' });

  const j = job.toJSON ? job.toJSON() : job;
  const state = await job.getState();
  const result = job.returnvalue ?? null;

  const tAdded = j.timestamp ?? j.timestampMs ?? j.addedAt ?? undefined;
  const tProc  = j.processedOn ?? undefined;
  const tFin   = j.finishedOn ?? undefined;

  const durations = {
    waitMs:    ms(tProc && tAdded ? tProc - tAdded : undefined),
    processMs: ms(tFin && tProc ? tFin - tProc : undefined),
    totalMs:   ms(tFin && tAdded ? tFin - tAdded : undefined),
  };

  // Próxima tentativa (estimativa simples)
  let nextRetryAt;
  if (state === 'failed' && j.attemptsMade < (j.opts?.attempts || 1)) {
    const base = typeof j.opts?.backoff === 'number'
      ? j.opts.backoff
      : (j.opts?.backoff?.delay ?? 0);
    const isExp = (j.opts?.backoff?.type || '').toLowerCase() === 'exponential';
    const delay = isExp ? base * Math.pow(2, j.attemptsMade) : base;
    nextRetryAt = delay ? iso((tFin || Date.now()) + delay) : undefined;
  }

  // Correlação com Mongo
  const simulationId = j.data?.simulationId || result?.simulationId || result?._id || undefined;
  let simulation;
  if (v >= 1 && simulationId) {
    try {
      const doc = await SimulatorCaixa.findById(simulationId)
        .lean()
        .select('_id status errorMessage createdAt updatedAt');
      if (doc) {
        simulation = {
          id: String(doc._id),
          status: doc.status,
          errorMessage: doc.errorMessage ?? null,
          createdAt: iso(doc.createdAt),
          updatedAt: iso(doc.updatedAt),
        };
      }
    } catch (e) {
      logger.warn(`Falha ao consultar simulação ${simulationId}: ${e.message}`);
    }
  }

  // Logs/stacktrace
  let logs, stacktrace;
  if (v >= 2) {
    try {
      const { logs: lines = [] } = await queue.getJobLogs(jobId);
      logs = lines.slice(-50);
    } catch (e) {
      logs = [`[warn] Falha ao buscar logs do job: ${e.message}`];
    }
    stacktrace = Array.isArray(j.stacktrace) ? j.stacktrace.slice(-3) : undefined;
  }

  const payload = {
    job: {
      id: j.id,
      name: j.name,
      state,
      attemptsMade: j.attemptsMade,
      opts: pick(j.opts || {}, ['attempts', 'backoff', 'delay', 'lifo', 'priority']),
      progress: j.progress ?? 0,
      timestamps: {
        addedAt: iso(tAdded),
        processedOn: iso(tProc),
        finishedOn: iso(tFin),
      },
      durations,
      failedReason: j.failedReason,
      nextRetryAt,
      result: v === 0 ? (result && pick(result, ['status'])) : result,
      input: maskInput(j.data || {}),
    },
    correlation: simulationId ? { simulationId } : undefined,
    simulation,
  };

  if (v >= 2) {
    payload.job.logs = logs;
    payload.job.stacktrace = stacktrace;
  }
  if (v >= 3) {
    payload.rawJob = j; // pode ser grande
  }

  return res.json(payload);
}

export async function getSimulationById(req, res) {
  const { id } = req.params;
  try {
    logger.info(`Consulta de simulação id=${id}`);
    const doc = await SimulatorCaixa.findById(id).lean();
    if (!doc) return res.status(404).json({ error: `Simulação com id ${id} não encontrada` });
    return res.json(doc);
  } catch (err) {
    logger.error(`Erro ao consultar simulação id=${id}: ${err.message}`);
    return res.status(500).json({ error: 'Erro interno ao buscar a simulação' });
  }
}
