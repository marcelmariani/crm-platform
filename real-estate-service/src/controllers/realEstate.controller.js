import mongoose from 'mongoose';
import RealEstate from '../models/realEstate.model.js';
import logger from '../config/logger.js';
import { userIsLinkedToRE } from '../utils/linkedAccess.js';

const isAdmin = (req) => !!req.access?.isAdmin;              // pré: GETs devem setar via tagAdminFromGroup
const me = (req) => String(req.user?.sub || '');
const isValidId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

const ownerBCs = (req) =>
  Array.isArray(req.scope?.ownerBankCorrespondentIds)
    ? req.scope.ownerBankCorrespondentIds.map(String)
    : [];

const asArr = (v) => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);
const intersects = (a, b) => {
  if (!a.length || !b.length) return false;
  const set = new Set(b.map(String));
  return a.some((x) => set.has(String(x)));
};

// LISTA: admin tudo; não-admin vê (ownerAuthId == sub) OU (BC ∈ ownerBankCorrespondentIds)
function scopeFilterRead(req) {
  if (isAdmin(req)) return {};
  const or = [{ ownerAuthId: me(req) }];
  const bcs = ownerBCs(req);
  if (bcs.length) or.push({ bankCorrespondentIds: { $in: bcs } });
  return { $or: or };
}

// WRITE: admin tudo; não-admin só se intersectar body/target com ownerBCs
function canWriteBody(req, body) {
  if (isAdmin(req)) return true;
  const bcs = ownerBCs(req);
  return bcs.length > 0 && intersects(asArr(body?.bankCorrespondentIds), bcs);
}

// -------- CREATE --------
export async function createRealEstate(req, res) {
  try {
    if (!isAdmin(req)) {
      if (!canWriteBody(req, req.body)) return res.status(403).json({ message: 'Sem permissão para criar' });
      req.body.ownerAuthId = me(req); // owner do registro pode apenas ler; BC owner tem CRUD
    } else if (!req.body?.ownerAuthId) {
      req.body.ownerAuthId = me(req);
    }
    const created = await RealEstate.create(req.body);
    return res.status(201).json(created);
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: 'Unique constraint violation' });
    return res.status(400).json({ message: err?.message || 'Bad request' });
  }
}

// -------- LIST --------
export async function getRealEstates(req, res) {
  try {
    const items = await RealEstate.find(scopeFilterRead(req)).lean();
    return res.json(items);
  } catch (err) {
    logger.error('getRealEstates error', { err });
    return res.status(500).json({ message: 'Internal error' });
  }
}

// -------- GET BY ID --------
export async function getRealEstateById(req, res) {
  try {
    logger.debug('GET /real-estates/:id start', {
      realEstateId: req.params.id,
      userSub: me(req),
      isAdmin: isAdmin(req),
      scope: req.scope,
    });
    const re = await RealEstate.findById(req.params.id).lean();
    if (!re) {
      logger.info('RealEstate document not found', { realEstateId: req.params.id, userSub: me(req) });
      return res.status(404).json({ message: 'not_found' });
    }

    const allowed = await userIsLinkedToRE(req, re);
    if (!allowed) {
      logger.info('Access denied to real estate', {
        realEstateId: req.params.id,
        userSub: me(req),
        ownerAuthId: re.ownerAuthId,
        reBankCorrespondentIds: re.bankCorrespondentIds,
        scopeOwnerBCs: req.scope?.ownerBankCorrespondentIds,
        scopeGroupBCs: req.scope?.groupBankCorrespondentIds,
      });
      return res.status(404).json({ message: 'Not found or forbidden' });
    }

    return res.json(re);
  } catch (err) {
    return res.status(500).json({ message: 'internal_error', detail: err?.message });
  }
}

// -------- UPDATE --------
export async function updateRealEstate(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: 'Invalid id' });

    if (!isAdmin(req) && 'ownerAuthId' in req.body) delete req.body.ownerAuthId;

    if (!isAdmin(req)) {
      if ('bankCorrespondentIds' in req.body && !canWriteBody(req, req.body)) {
        return res.status(403).json({ message: 'Sem permissão para alterar correspondentes' });
      }
      const bcs = ownerBCs(req);
      if (!bcs.length) return res.status(403).json({ message: 'Sem permissão para atualizar' });

      const updated = await RealEstate.findOneAndUpdate(
        { _id: id, bankCorrespondentIds: { $in: bcs } },  // só BCs que o usuário é owner
        req.body,
        { new: true, runValidators: true }
      ).lean();
      if (!updated) return res.status(404).json({ message: 'Not found or forbidden' });
      return res.json(updated);
    }

    const updated = await RealEstate.findOneAndUpdate({ _id: id }, req.body, { new: true, runValidators: true }).lean();
    if (!updated) return res.status(404).json({ message: 'Not found' });
    return res.json(updated);
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ message: 'Unique constraint violation' });
    return res.status(400).json({ message: err?.message || 'Bad request' });
  }
}

// -------- DELETE --------
export async function deleteRealEstate(req, res) {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: 'Invalid id' });

    if (!isAdmin(req)) {
      const bcs = ownerBCs(req);
      if (!bcs.length) return res.status(403).json({ message: 'Sem permissão para excluir' });
      const deleted = await RealEstate.findOneAndDelete({ _id: id, bankCorrespondentIds: { $in: bcs } }).lean();
      if (!deleted) return res.status(404).json({ message: 'Not found or forbidden' });
      return res.status(204).send();
    }

    const deleted = await RealEstate.findOneAndDelete({ _id: id }).lean();
    if (!deleted) return res.status(404).json({ message: 'Not found' });
    return res.status(204).send();
  } catch (err) {
    logger.error('deleteRealEstate error', { err });
    return res.status(500).json({ message: 'Internal error' });
  }
}

// -------- IDS --------
export async function getRealEstateIds(req, res) {
  try {
    const docs = await RealEstate.find(scopeFilterRead(req)).select('_id').lean();
    return res.json(docs.map((d) => String(d._id)));
  } catch (err) {
    logger.error('getRealEstateIds error', { err });
    return res.status(500).json({ message: 'Internal error' });
  }
}

// -------- AUX --------
export async function getRealEstateByGroup(req, res) {
  try {
    const ids = Array.isArray(req.scope?.realEstateIds) ? req.scope.realEstateIds : [];
    if (!ids.length) return res.json([]);
    const docs = await RealEstate.find({ _id: { $in: ids } }).lean();
    return res.json(docs);
  } catch (err) {
    logger.error('listRealEstateByGroup error', { err });
    return res.status(500).json({ message: 'Internal error' });
  }
}

export async function getRealEstateByCorrespondent(req, res) {
  try {
    const { bankCorrespondentId } = req.params;
    const docs = await RealEstate.find({ bankCorrespondentIds: String(bankCorrespondentId) }).lean();
    return res.json(docs);
  } catch (err) {
    logger.error('listRealEstateByCorrespondent error', { err });
    return res.status(500).json({ message: 'Internal error' });
  }
}
