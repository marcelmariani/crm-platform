// src/services/grantService.js
import GroupResourceGrant from '../models/groupResourceGrant.model.js';
import Group from '../models/group.model.js';
import Resource from '../models/resource.model.js';
import logger from '../config/auth.logger.js';

const scopeRank = (s) => (s === 'all' ? 3 : s === 'own+linked' ? 2 : 1);

/**
 * Calcula o grant efetivo:
 * - Usa o grant do PRÓPRIO grupo se existir.
 * - Caso contrário, combina apenas ancestrais NÃO-admin.
 * - Nunca herda do grupo "admin".
 */
export async function getEffectiveGrant({ groupId, resourceId, resourceName }) {
  //logger.debug('getEffectiveGrant:start', { groupId: String(groupId || ''), resourceId: String(resourceId || ''), resourceName });
  if (!groupId) return { perms: 0, scope: 'own' };

  // Resolve resourceId por nome se necessário
  let rId = resourceId;
  if (!rId && resourceName) {
    const r = await Resource.findOne({ resourceName, status: 'active' }).select('_id').lean();
    if (!r) {
      //logger.debug('getEffectiveGrant:resourceNotFoundByName', { resourceName });
      return { perms: 0, scope: 'own' };
    }
    rId = r._id;
    //logger.debug('getEffectiveGrant:resourceResolved', { resourceName, resourceId: String(rId) });
  }
  if (!rId) return { perms: 0, scope: 'own' };

  // Grupo e cadeia
  const group = await Group.findById(groupId).select('_id name ancestors').lean();
  if (!group) {
    logger.debug('getEffectiveGrant:groupNotFound', { groupId: String(groupId) });
    return { perms: 0, scope: 'own' };
  }

  const allIds = [groupId, ...(group.ancestors || [])];

  // Carrega nomes para filtrar admin
  const groupsInfoArr = await Group.find({ _id: { $in: allIds } }).select('_id name').lean();
  const groupsInfo = Object.fromEntries(groupsInfoArr.map(g => [String(g._id), g.name]));

  // Permitir apenas ancestrais não-admin
  const allowedIds = [groupId, ...allIds.filter(id =>
    String(id) !== String(groupId) && groupsInfo[String(id)] !== 'admin'
  )];
  const excludedAdminIds = allIds.filter(id => String(id) !== String(groupId) && groupsInfo[String(id)] === 'admin').map(String);
  /*logger.debug('getEffectiveGrant:groupChain', {
    groupName: group.name,
    allIds: allIds.map(String),
    allowedIds: allowedIds.map(String),
    excludedAdminIds,
  });*/

  // Grants do próprio + ancestrais permitidos
  const grants = await GroupResourceGrant
    .find({ groupId: { $in: allowedIds }, resourceId: rId })
    .select('groupId perms scope')
    .lean();
  //logger.debug('getEffectiveGrant:grantsFetched', { count: grants.length });

  // 1) Grant do próprio grupo prevalece
  const ownGrant = grants.find(g => String(g.groupId) === String(groupId));
  if (ownGrant) {
    //logger.debug('getEffectiveGrant:usingOwnGrant', { groupId: String(groupId), groupName: group.name, perms: ownGrant.perms, scope: ownGrant.scope });
    return {
      groupId,
      resourceId: rId,
      perms: ownGrant.perms,
      scope: ownGrant.scope,
      groupName: group.name,
    };
  }

  // 2) Sem grant próprio: combina ancestrais não-admin
  const ancestorGrants = grants.filter(g => String(g.groupId) !== String(groupId));
  if (ancestorGrants.length === 0) {
    //logger.debug('getEffectiveGrant:noAncestorGrant');
    return { groupId, resourceId: rId, perms: 0, scope: 'own' };
  }

  let combined = { perms: 0, scope: 'own' };
  let bestGrant = null;
  for (const g of ancestorGrants) {
    combined.perms |= g.perms;
    if (scopeRank(g.scope) > scopeRank(combined.scope)) combined.scope = g.scope;
    if (
      !bestGrant ||
      scopeRank(g.scope) > scopeRank(bestGrant.scope) ||
      (scopeRank(g.scope) === scopeRank(bestGrant.scope) && (g.perms | 0) > (bestGrant.perms | 0))
    ) bestGrant = g;
  }

  if (combined.perms === 0) {
    //logger.debug('getEffectiveGrant:combinedNoPerms');
    return { groupId, resourceId: rId, perms: 0, scope: 'own' };
  }

  const result = {
    groupId,
    resourceId: rId,
    perms: combined.perms,
    scope: combined.scope,
    inheritedFromGroupId: bestGrant ? String(bestGrant.groupId) : undefined,
    inheritedFromGroupName: bestGrant ? groupsInfo[String(bestGrant.groupId)] : undefined,
  };
  logger.debug('getEffectiveGrant:result', {
    groupId: String(groupId),
    resourceId: String(rId),
    perms: result.perms,
    scope: result.scope,
    inheritedFromGroupId: result.inheritedFromGroupId,
    inheritedFromGroupName: result.inheritedFromGroupName,
  });
  return result;
}
