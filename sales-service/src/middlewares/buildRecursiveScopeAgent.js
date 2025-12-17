/**
 * Popula req.scope exclusivamente a partir do usuário autenticado (authorization).
 * Não lê headers x-*.
 *
 * Estruturas aceitas em req.user (JWT claims):
 * - aid = agentId
 * - reid = realEstateId
 * - bcid = bankCorrespondentId
 * - agentId | agentIds (compat legado)
 * - realEstateId | realEstateIds (compat legado)
 * - ownerBcId | ownerBcIds (compat legado)
 * - groupBcId | groupBcIds (compat legado)
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

  // Prioriza claims curtos (aid, reid, bcid), fallback para legado
  const agentIds = uniq([
    ...normArr(u.aid),
    ...normArr(u.agentId),
    ...normArr(u.agentIds)
  ]);

  const realEstateIds = uniq([
    ...normArr(u.reid),
    ...normArr(u.realEstateId),
    ...normArr(u.realEstateIds)
  ]);

  const ownerBcIds = uniq([
    ...normArr(u.bcid),
    ...normArr(u.bankCorrespondentId),
    ...normArr(u.ownerBcId),
    ...normArr(u.ownerBcIds)
  ]);

  const groupBcIds = uniq([
    ...normArr(u.groupBcId),
    ...normArr(u.groupBcIds)
  ]);

  req.scope = { agentIds, realEstateIds, ownerBcIds, groupBcIds };
  next();
}
