// src/middlewares/authorizeGroupResource.js
import { PERM } from '../models/GroupResourceGrant.js';
import { getEffectiveGrant } from '../services/grantService.js';

/**
 * Autoriza por recurso usando grants efetivos do grupo do usuário.
 * Requer que authorizeAccessUser já tenha populado req.user.group.
 *
 * @param {string} resourceName
 * @param {number} requiredPerm  Bitmask (PERM.*). Default: READ
 */
export const authorizeGroupResource = (resourceName, requiredPerm = PERM.READ) => {
  return async (req, res, next) => {
    try {
      const groupId = req.user?.group;
      if (!groupId) return res.status(401).json({ message: 'Usuário não autenticado' });

      const grant = await getEffectiveGrant({ groupId, resourceName });
      if (!grant || (grant.perms & requiredPerm) !== requiredPerm) {
        return res.status(403).json({ message: 'Não autorizado' });
      }

      req.grant = grant; // disponível para a rota
      return next();
    } catch (err) {
      return res.status(502).json({ message: 'Auth-service indisponível', detail: err?.message || 'ERR' });
    }
  };
};

export { PERM } from '../models/GroupResourceGrant.js';
