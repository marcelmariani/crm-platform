// auth-service/src/controllers/grantController.js
import GroupResourceGrant, { PERM, SCOPES } from '../models/groupResourceGrant.model.js';
import Resource from '../models/resource.model.js';
import { getEffectiveGrant as computeEffectiveGrant } from '../services/grant.service.js';

export async function upsertGrant(req, res) {
  try {
    const { groupId, resourceId, resourceName, perms, scope } = req.body;

    if (!perms && perms !== 0) return res.status(400).json({ message: 'perms is required (0..15)' });
    if (scope && !Object.values(SCOPES).includes(scope)) {
      return res.status(400).json({ message: `invalid scope (${Object.values(SCOPES).join(', ')})` });
    }

    let gId = groupId;
    if (!gId && req.query.groupId) gId = req.query.groupId;
    if (!gId) return res.status(400).json({ message: 'groupId is required' });

    let rId = resourceId;
    if (!rId && resourceName) {
      const r = await Resource.findOne({ resourceName, status: 'active' }).select('_id').lean();
      if (!r) return res.status(404).json({ message: `resource "${resourceName}" not found` });
      rId = r._id;
    }
    if (!rId) return res.status(400).json({ message: 'resourceId or resourceName is required' });

    const doc = await GroupResourceGrant.findOneAndUpdate(
      { groupId: gId, resourceId: rId },
      { $set: { perms, scope: scope || 'own' } },
      { upsert: true, new: true }
    ).lean();

    return res.json(doc);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export async function listGrants(req, res) {
  try {
    const { groupId, resourceId } = req.query;
    const filter = {};
    if (groupId) filter.groupId = groupId;
    if (resourceId) filter.resourceId = resourceId;

    const docs = await GroupResourceGrant.find(filter).lean();
    return res.json(docs);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

/**
 * Retorna o grant efetivo (OR) para groupId + resourceId/resourceName,
 * considerando ancestors do grupo.
 */
export async function getEffectiveGrant(req, res) {
  try {
    const { groupId, resourceId, resourceName } = req.query;
    if (!groupId) return res.status(400).json({ message: 'groupId is required' });

    const result = await computeEffectiveGrant({ groupId, resourceId, resourceName });
    if (!result.resourceId && resourceName && !resourceId) {
      return res.status(404).json({ message: `resource "${resourceName}" not found` });
    }

    // result may default perms=0, scope='own'
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
}

export const GrantsPERM = PERM; // se quiser reusar constantes

