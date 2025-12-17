import BankCorrespondent from '../models/bankCorrespondent.model.js';

// Owner match (ownerAuthId pode ser String/ObjectId)
const ownExpr = (sub) => ({ $expr: { $eq: [{ $toString: '$ownerAuthId' }, String(sub)] } });

// Leitura do scope vindo do middleware authorizeGroupResource
function readScope(req) {
  const scope = req.grant?.scope || 'own'; // 'own' | 'own+linked' | 'all'
  return scope === 'all';
}

export async function getBankCorrespondents(req, res) {
  try {
    const isAll = readScope(req);
    const q = {};

    // filtros opcionais
    if (req.query.groupId) q.groupId = String(req.query.groupId);
    if (req.query.ownerAuthId) q.ownerAuthId = String(req.query.ownerAuthId);

    // escopo
    if (!isAll) {
      // em bank-correspondent não há "linked" relevante → tratar own+linked como own
      Object.assign(q, ownExpr(req.user.sub));
      delete q.ownerAuthId; // não permitir overreach por query
    }

    const items = await BankCorrespondent.find(q).lean();
    return res.json(items);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function getBankCorrespondentById(req, res) {
  try {
    const isAll = readScope(req);
    const { id } = req.params;

    const doc = await BankCorrespondent.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });

    if (!isAll && String(doc.ownerAuthId) !== String(req.user.sub)) {
      // own+linked não dá acesso ao recurso pai (bank-correspondent)
      return res.status(403).json({ message: 'Forbidden' });
    }
    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function createBankCorrespondent(req, res) {
  try {
    const payload = { ...req.body, ownerAuthId: req.user.sub };
    delete payload.status; // FSM protegido

    const created = await BankCorrespondent.create(payload);
    return res.status(201).json(created.toJSON());
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'Duplicate key' });
    return res.status(400).json({ message: e.message });
  }
}

export async function updateBankCorrespondent(req, res) {
  try {
    const isAll = readScope(req);
    const { id } = req.params;

    const body = { ...req.body };
    delete body.status;

    const doc = await BankCorrespondent.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (!isAll && String(doc.ownerAuthId) !== String(req.user.sub)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const updated = await BankCorrespondent.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true }).lean();
    return res.json(updated);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'Duplicate key' });
    return res.status(400).json({ message: e.message });
  }
}

export async function deleteBankCorrespondent(req, res) {
  try {
    const isAll = readScope(req);
    const { id } = req.params;

    const doc = await BankCorrespondent.findById(id).lean();
    if (!doc) return res.status(404).json({ message: 'Not found' });
    if (!isAll && String(doc.ownerAuthId) !== String(req.user.sub)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    await BankCorrespondent.findByIdAndDelete(id);
    return res.status(204).end();
  } catch (e) {
    return res.status(400).json({ message: e.message });
  }
}

// Normaliza shape para conter realEstateIds: string[]
function normalize(bc) {
  if (!bc) return null;
  const out = { ...bc };
  let ids = Array.isArray(out.realEstateIds) ? out.realEstateIds.map(String) : [];
  if (!ids.length && Array.isArray(out.realEstates)) {
    ids = out.realEstates
      .map(r => (r && (r._id || r.id)) ? String(r._id || r.id) : null)
      .filter(Boolean);
  }
  out.realEstateIds = Array.from(new Set(ids));
  return out;
}

export async function getBankCorrespondentByGroup(req, res) {
  try {
    const isAll = readScope(req);
    const { groupId } = req.params;

    const bc = await BankCorrespondent.findOne({ groupId }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    if (!bc) return res.status(404).json({ message: 'Bank correspondent not found for group' });

    if (!isAll && String(bc.ownerAuthId) !== String(req.user.sub)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    return res.json(normalize(bc));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

export async function getBankCorrespondentByOwner(req, res) {
  try {
    const isAll = readScope(req);
    const ownerParam = String(req.params.ownerAuthId || req.params.authId || '');

    // only ALL can query by arbitrary owner; otherwise force current user
    const ownerId = isAll ? ownerParam || String(req.user.sub) : String(req.user.sub);

    const bc = await BankCorrespondent.findOne({ ownerAuthId: ownerId }).sort({ updatedAt: -1, createdAt: -1 }).lean();
    if (!bc) return res.status(404).json({ message: 'Bank correspondent not found for owner' });

    return res.json(normalize(bc));
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}
