//sellerController.js
import Seller, { canTransition, STATUS } from '../models/sellerModel.js';
import logger from '../config/logger.js';
import { z } from 'zod';
import { presentseller } from '../mappers/sellerPresenter.js';

const createSchema = z.object({
  documentNumber: z.string().min(1),
  phoneNumber: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  birthDate: z.coerce.date().optional(),
  monthlyIncome: z.coerce.number().optional(),
  fiscalType: z.enum(['person', 'company']).optional(),
});

const updateSchema = z
  .object({
    documentNumber: z.string().optional(),
    phoneNumber: z.string().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    birthDate: z.coerce.date().optional(),
    monthlyIncome: z.coerce.number().optional(),
    fiscalType: z.enum(['person', 'company']).optional(),
  })
  .strict();

const statusSchema = z.object({
  status: z.enum(['active', 'inactive']),
  note: z.string().max(500).optional(),
});

function firstOrNull(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function buildScopeFilter(req) {
  const isAdmin = req.access?.isAdmin === true;
  const scope = req.grant?.scope || 'own';
  if (isAdmin || scope === 'all') return {};

  const sub = String(req.user?.sub || '');
  const group = String(req.user?.group || '');
  const agentIds = req.scope?.agentIds || [];
  const reIds = req.scope?.realEstateIds || [];
  const bcIds = [...(req.scope?.ownerBcIds || []), ...(req.scope?.groupBcIds || [])];

  const or = [{ createdByAuthId: sub }];

  if (scope === 'org') {
    or.push({ createdByGroupId: group });
    if (agentIds.length) or.push({ createdAtAgentId: { $in: agentIds } });
    if (reIds.length) or.push({ createdAtRealEstateId: { $in: reIds } });
    if (bcIds.length) or.push({ createdAtBankCorrespondentId: { $in: bcIds } });
  }

  return { $or: or };
}

export const createseller = async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
    }

    const scope = req.scope || {};
    const payload = {
      ...parsed.data,
      createdByAuthId: String(req.user?.sub || ''),
      createdByUserName: req.user?.userName || '',
      createdByGroupId: String(req.user?.group || ''),
      createdAtAgentId: firstOrNull(scope.agentIds) || null,
      createdAtRealEstateId: firstOrNull(scope.realEstateIds) || null,
      createdAtBankCorrespondentId: firstOrNull(scope.ownerBcIds) || firstOrNull(scope.groupBcIds) || null,
    };

    const doc = await Seller.create(payload);
    logger.info('seller created', {
      sellerId: doc._id,
      createdByAuthId: payload.createdByAuthId,
      createdAtAgentId: payload.createdAtAgentId,
    });
    res.status(201).json(presentseller(doc));
  } catch (error) {
    logger.error('Error creating seller', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

export const getsellers = async (req, res) => {
  try {
    const filter = buildScopeFilter(req);
    const page = Math.max(parseInt(req.query.page ?? '1', 10), 1);
    const limitReq = Math.max(parseInt(req.query.limit ?? '20', 10), 1);
    const limit = Math.min(limitReq, 100);
    const sort = req.query.sort ?? '-createdAt';

    const [rows, total] = await Promise.all([
      Seller.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Seller.countDocuments(filter),
    ]);

    res.json({
      page,
      limit,
      total,
      rows: rows.map(presentseller),
    });
  } catch (error) {
    logger.error('Error listing sellers', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const getsellerById = async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const doc = await Seller.findOne(filter).lean();
    if (!doc) return res.status(404).json({ error: 'Vendedor não encontrado' });
    res.json(presentseller(doc));
  } catch (error) {
    logger.error('Error fetching seller', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const updateseller = async (req, res) => {
  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      return res.status(400).json({ error: "Campo 'status' é controlado por PATCH /sellers/:id/status" });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });

    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const updated = await Seller.findOneAndUpdate(filter, parsed.data, {
      new: true,
      runValidators: true,
    }).lean();

    if (!updated) return res.status(404).json({ error: 'Vendedor não encontrado' });
    res.json(presentseller(updated));
  } catch (error) {
    logger.error('Error updating seller', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

export const deleteseller = async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const deleted = await Seller.findOneAndDelete(filter).lean();
    if (!deleted) return res.status(404).json({ error: 'Vendedor não encontrado' });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting seller', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const patchSellerStatus = async (req, res) => {
  try {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join(', ') });
    }

    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const doc = await Seller.findOne(filter);
    if (!doc) return res.status(404).json({ error: 'Vendedor não encontrado' });

    const from = doc.status || 'created';
    const to = parsed.data.status;

    if (!STATUS.includes(from) || !STATUS.includes(to)) {
      return res.status(400).json({ error: 'Transição de status inválida' });
    }
    if (!canTransition(from, to)) {
      return res.status(400).json({ error: `Transição não permitida: ${from} -> ${to}` });
    }

    const historyEntry = {
      from,
      to,
      note: parsed.data.note || 'alteração de status',
      changedByAuthId: String(req.user?.sub || ''),
      changedByUserName: req.user?.userName || null,
      changedAt: new Date(),
    };

    const updated = await Seller.findOneAndUpdate(
      { _id: doc._id },
      {
        $set: { status: to, updatedAt: new Date() },
        $push: { statusHistory: historyEntry },
      },
      { new: true }
    ).lean();

    logger.info('seller status changed', { sellerId: doc._id, from, to });
    return res.json(presentseller(updated));
  } catch (error) {
    logger.error('Erro ao alterar status do vendedor', { error: error.message, sellerId: req.params.id });
    res.status(500).json({ error: 'Erro interno' });
  }
};
