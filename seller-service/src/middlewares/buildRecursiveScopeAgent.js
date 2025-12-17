/**
 * Popula req.scope exclusivamente a partir do usuário autenticado (authorization).
 * Não lê headers x-*.
 *
 * Estruturas aceitas em req.user:
 * - agentId | agentIds
 * - realEstateId | realEstateIds
 * - ownerBcId | ownerBcIds
 * - groupBcId | groupBcIds
 */
function normArr(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

export async function buildRecursiveScopeAgent(req, _res, next) {
  const u = req.user || {};

  const agentIds = uniq([...normArr(u.agentId), ...normArr(u.agentIds)]);
  const realEstateIds = uniq([...normArr(u.realEstateId), ...normArr(u.realEstateIds)]);
  const ownerBcIds = uniq([...normArr(u.ownerBcId), ...normArr(u.ownerBcIds)]);
  const groupBcIds = uniq([...normArr(u.groupBcId), ...normArr(u.groupBcIds)]);

  req.scope = { agentIds, realEstateIds, ownerBcIds, groupBcIds };
  next();
}
