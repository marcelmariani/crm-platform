import mongoose from 'mongoose';
import logger from '../config/auth.logger.js';
import {
  createGroup,
  getGroupById,
  listGroups,
  updateGroup,
  deleteGroup
} from '../services/group.service.js';

/**
 * Controller para criação de grupo.
 */
export async function createGroupController(req, res) {
  const { name, parent } = req.body;

  // Validação de entrada
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Campo "name" é obrigatório e deve ser uma string.' });
  }
  if (parent && !mongoose.Types.ObjectId.isValid(parent)) {
    return res.status(400).json({ error: 'Campo "parent" deve ser um ObjectId válido.' });
  }

  try {
    const group = await createGroup({ name, parent });
    return res.status(201).json(group);
  } catch (err) {
    logger.error('Erro ao criar grupo:', err);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Controller para listagem de todos os grupos.
 */
export async function listGroupsController(req, res) {
  try {
    const groups = await listGroups();
    return res.json(groups);
  } catch (err) {
    logger.error('Erro ao listar grupos:', err);
    return res.status(500).json({ error: 'Erro ao listar grupos' });
  }
}

/**
 * Controller para obter grupo por ID.
 */
export async function getGroupByIdController(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const group = await getGroupById(id);
    if (!group) {
      return res.status(404).json({ error: 'Grupo não encontrado' });
    }
    return res.json(group);
  } catch (err) {
    logger.error('Erro ao buscar grupo por ID:', err);
    return res.status(500).json({ error: 'Erro ao buscar grupo' });
  }
}

/**
 * Controller para atualizar grupo.
 */
export async function updateGroupController(req, res) {
  const { id } = req.params;
  const { name, parent } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const group = await updateGroup(id, { name, parent });
    return res.json(group);
  } catch (err) {
    logger.error('Erro ao atualizar grupo:', err);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Controller para deletar grupo.
 */
export async function deleteGroupController(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    await deleteGroup(id);
    return res.status(204).send();
  } catch (err) {
    logger.error('Erro ao deletar grupo:', err);
    return res.status(400).json({ error: err.message });
  }
}
