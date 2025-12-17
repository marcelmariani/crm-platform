// src/middlewares/authorizeAccessAdmin.js
import Group from '../models/group.model.js';

/**
 * Exige que o usuário autenticado pertença ao grupo "admin".
 * Depende de authorizeAccessUser ter populado req.user.group.
 * Evita chamada HTTP ao próprio serviço; lê direto do banco.
 */
export const authorizeAccessAdmin = async (req, res, next) => {
  try {
    const groupId = req.user?.group;
    if (!groupId) {
      return res.status(401).json({ message: 'Missing user group' });
    }

    // Validação defensiva: evitar CastError de ObjectId inválido
    const isValidObjectId = typeof groupId === 'string' && /^[a-fA-F0-9]{24}$/.test(groupId);
    if (!isValidObjectId) {
      return res.status(401).json({ message: 'Invalid group identifier in token' });
    }

    const group = await Group.findById(groupId).select('name').lean();
    if (!group) {
      return res.status(401).json({ message: 'Grupo não encontrado' });
    }
    if (String(group.name).toLowerCase() !== 'admin') {
      return res.status(403).json({ message: 'Acesso restrito a administradores' });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Erro interno no controle de acesso' });
  }
};
