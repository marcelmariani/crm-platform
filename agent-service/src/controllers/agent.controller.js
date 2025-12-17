// src/controllers/agentController.js
import https from 'https';
import mongoose from 'mongoose';
import Agent from '../models/agent.model.js';
import { listRealEstatesByOwner } from '../services/realEstate.service.js';
import { listCorrespondentsByOwner } from '../services/correspondent.service.js';

const now = () => process.hrtime.bigint();
const ms = (a, b) => Number(b - a) / 1e6;
const logPerf = (route, parts) => console.info('perf', route, parts);

function strSet(arr) {
  return new Set((arr || []).map(String).filter(Boolean));
}

async function hasAccessToAgent({ req, agentDoc }) {
  const t0 = now();

  const isAdmin = req.access?.isAdmin === true;
  if (isAdmin) {
    logPerf('hasAccessToAgent', { admin: true, total_ms: ms(t0, now()) });
    return true;
  }

  const sub = String(req.user?.sub || '');
  if (!sub) {
    logPerf('hasAccessToAgent', { noSub: true, total_ms: ms(t0, now()) });
    return false;
  }

  // 1) dono do agente
  if (agentDoc.ownerAuthId && String(agentDoc.ownerAuthId) === sub) {
    logPerf('hasAccessToAgent', { ownerDirect: true, total_ms: ms(t0, now()) });
    return true;
  }

  // 2) dono de alguma real-estate vinculada
  const agentRE = strSet(agentDoc.realEstateIds || []);
  if (agentRE.size > 0) {
    const tRE0 = now();
    const ownerREs = await listRealEstatesByOwner({
      ownerAuthId: sub,
      authorization: req.headers.authorization,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !(
          process.env.NODE_ENV === 'development' ||
          process.env.SKIP_TLS_VERIFY === 'true'
        ),
      }),
    });
    const tRE1 = now();
    const ownerREids = strSet(ownerREs.map(r => r._id || r.id));
    for (const id of agentRE) if (ownerREids.has(id)) {
      logPerf('hasAccessToAgent', { check: 'RE', http_ms: ms(tRE0, tRE1), total_ms: ms(t0, now()) });
      return true;
    }
    logPerf('hasAccessToAgent', { check: 'RE', http_ms: ms(tRE0, tRE1) });
  }

  // 3) dono de correspondente bancário vinculado
  const agentBC = strSet(agentDoc.bankCorrespondentIds || []);
  if (agentBC.size > 0) {
    const tBC0 = now();
    const ownerBCs = await listCorrespondentsByOwner({
      ownerAuthId: sub,
      authorization: req.headers.authorization,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !(
          process.env.NODE_ENV === 'development' ||
          process.env.SKIP_TLS_VERIFY === 'true'
        ),
      }),
    });
    const tBC1 = now();
    const ownerBCids = strSet(ownerBCs.map(c => c._id || c.id));
    for (const id of agentBC) if (ownerBCids.has(id)) {
      logPerf('hasAccessToAgent', { check: 'BC', http_ms: ms(tBC0, tBC1), total_ms: ms(t0, now()) });
      return true;
    }
    logPerf('hasAccessToAgent', { check: 'BC', http_ms: ms(tBC0, tBC1) });
  }

  logPerf('hasAccessToAgent', { allowed: false, total_ms: ms(t0, now()) });
  return false;
}

export async function createAgent(req, res) {
  try {
    const isAdmin = req.access?.isAdmin === true;
    const payload = { ...req.body };

    if (!isAdmin) {
      payload.ownerAuthId = req.user.sub;

      // precisa ter ao menos um realEstateId do dono (regras de criação mínimas)
      const ownerREs = await listRealEstatesByOwner({
        ownerAuthId: String(req.user?.sub || ''),
        authorization: req.headers.authorization,
        httpsAgent: new https.Agent({
          rejectUnauthorized: !(
            process.env.NODE_ENV === 'development' ||
            process.env.SKIP_TLS_VERIFY === 'true'
          ),
        }),
      });
      const ownerREids = strSet(ownerREs.map(r => r._id || r.id));
      const input = Array.isArray(payload.realEstateIds)
        ? payload.realEstateIds.map(String)
        : [];
      const ok = input.some(id => ownerREids.has(id));
      if (!ok) return res.status(403).json({ message: 'No allowed realEstateIds in payload' });
    }

    const doc = await Agent.create(payload);
    return res.status(201).json(doc);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
}

export async function getAgents(req, res) {
  try {
    const isAdmin = req.access?.isAdmin === true;
    if (isAdmin) {
      const docs = await Agent.find({}).lean();
      return res.json(docs);
    }

    // Regra: usuário comum lista somente seus próprios agentes
    const ownerId = String(req.user?.sub || '');
    const docs = await Agent.find({ ownerAuthId: ownerId }).lean();
    return res.json(docs);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function getAgentById(req, res) {
  try {
    const { id } = req.params;
    const doc = await Agent.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });

    const allowed = await hasAccessToAgent({ req, agentDoc: doc });
    if (!allowed) return res.status(404).json({ message: 'Not found or forbidden' });

    return res.json(doc);
  } catch (e) {
    if (e?.name === 'CastError') return res.status(404).json({ message: 'Not found or forbidden' });
    return res.status(500).json({ message: e.message });
  }
}

export async function updateAgent(req, res) {
  try {
    const { id } = req.params;
    const current = await Agent.findById(id).lean();
    if (!current) return res.status(404).json({ message: 'Not found' });

    if (!(req.access?.isAdmin === true) && !(await hasAccessToAgent({ req, agentDoc: current }))) {
      return res.status(404).json({ message: 'Not found or forbidden' });
    }

    const doc = await Agent.findByIdAndUpdate(
      id,
      req.body,
      { new: true, runValidators: true }
    ).lean();
    return res.json(doc);
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
}

export async function deleteAgent(req, res) {
  try {
    const { id } = req.params;
    const current = await Agent.findById(id).lean();
    if (!current) return res.status(404).json({ message: 'Not found' });

    if (!(req.access?.isAdmin === true) && !(await hasAccessToAgent({ req, agentDoc: current }))) {
      return res.status(404).json({ message: 'Not found or forbidden' });
    }

    await Agent.findByIdAndDelete(id).lean();
    return res.status(204).send();
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function listAgentsByOwner(req, res) {
  try {
    const { ownerAuthId } = req.params;
    const { status } = req.query;

    const filter = {};
    // aceita ObjectId (24 hex) ou string
    filter.ownerAuthId = mongoose.isValidObjectId(ownerAuthId)
      ? new mongoose.Types.ObjectId(ownerAuthId)
      : ownerAuthId;

    if (status) filter.status = String(status).toLowerCase();

    const agents = await Agent.find(filter).lean();
    return res.json(agents); // [] se nenhum encontrado
  } catch (err) {
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
}

export async function getActiveByPhoneNumber(req, res, next) {
  const t0 = now();
  try {
    const raw = String(req.params.phoneNumber || '');
    const phone = raw.replace(/\D/g, '');
    if (!phone) return res.status(400).json({ message: 'phoneNumber é obrigatório' });

    const tDb0 = now();
    const q = Agent.findOne({ phoneNumber: phone, status: 'active' }).lean();
    if (process.env.USE_HINT === '1') q.hint({ phoneNumber: 1, status: 1 });
    const agent = await q;
    const tDb1 = now();

    const total = ms(t0, now());
    const db = ms(tDb0, tDb1);

    res.set('X-Perf-DB-ms', db.toFixed(3));
    res.set('X-Perf-Total-ms', total.toFixed(3));
    logPerf('GET /agents/by-phone/:phoneNumber', { db_ms: db, total_ms: total });

    if (!agent) return res.status(404).json({ message: 'Agent não encontrado ou inativo' });
    return res.status(200).json(agent);
  } catch (err) {
    logPerf('GET /agents/by-phone/:phoneNumber', { error: err.message, total_ms: ms(t0, now()) });
    next(err);
  }
}
export async function getActiveByWhatsappJid(req, res, next) {
  const t0 = now();
   try {
    const jid = String(req.params.whatsappJid || '').trim();
    if (!jid) return res.status(400).json({ message: 'whatsappJid é obrigatório' });
     const tDb0 = now();
     const q = Agent.findOne({ whatsappJid: jid, status: 'active' }).lean();
    if (process.env.USE_HINT === '1') q.hint({ whatsappJid: 1, status: 1 });
     const agent = await q;
     const tDb1 = now();
     const total = ms(t0, now());
     const db = ms(tDb0, tDb1);

      res.set('X-Perf-DB-ms', db.toFixed(3));
      res.set('X-Perf-Total-ms', total.toFixed(3));
      logPerf('GET /agents/by-whatsapp/:whatsappJid', { db_ms: db, total_ms: total });

    if (!agent) return res.status(404).json({ message: 'Agent não encontrado ou inativo' });
      return res.status(200).json(agent);
    } catch (err) {
      logPerf('GET /agents/by-whatsapp/:whatsappJid', { error: err.message, total_ms: ms(t0, now()) });
      next(err);
    }
}
