/**
 * Popula req.scope exclusivamente a partir do usuário autenticado (authorization).
 * Não lê headers x-*.
 *
 * JWT Claims utilizados:
 * - aid = agentId
 * - reid = realEstateId
 * - bcid = bankCorrespondentId
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

  // Mapeia os claims JWT (aid, reid, bcid) para arrays
  const agentIds = uniq(normArr(u.aid));
  const realEstateIds = uniq(normArr(u.reid));
  const ownerBcIds = uniq(normArr(u.bcid));
  const groupBcIds = []; // Mantém vazio - bcid já representa o banco correspondente

  req.scope = { agentIds, realEstateIds, ownerBcIds, groupBcIds };
  next();
}
