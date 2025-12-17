import mongoose from 'mongoose';
import logger from '../config/auth.logger.js';
import {
  createResource,
  listResources,
  getResourceById,
  getResourceByName,
  updateResource,
  deleteResource
} from '../services/resource.service.js';

/**
 * POST /v1/resources
 */
export async function createResourceController(req, res) {
  const { resourceName, status } = req.body;
  if (!resourceName) {
    return res.status(400).json({ error: 'resourceName é obrigatório.' });
  }
  try {
    const created = await createResource({ resourceName, status });
    return res.status(201).json(created);
  } catch (err) {
    // Duplicidade -> 409
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'resourceName já existente.' });
    }
    logger.error('Erro ao criar recurso:', err);
    return res.status(500).json({ error: 'Erro ao criar recurso.' });
  }
}

/**
 * GET /v1/resources
 */
export async function listResourcesController(req, res) {
  try {
    const items = await listResources({ status: req.query.status });
    return res.json(items);
  } catch (err) {
    logger.error('Erro ao listar recursos:', err);
    return res.status(500).json({ error: 'Erro ao listar recursos.' });
  }
}

/**
 * GET /v1/resources/:id
 */
export async function getResourceByIdController(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }
  try {
    const item = await getResourceById(id);
    if (!item) {
      return res.status(404).json({ error: 'Recurso não encontrado.' });
    }
    return res.json(item);
  } catch (err) {
    logger.error('Erro ao obter recurso:', err);
    return res.status(500).json({ error: 'Erro ao obter recurso.' });
  }
}

/**
 * GET /v1/resources/by-name/:resourceName
 */
export async function getResourceByNameController(req, res) {
  const { resourceName } = req.params;
  if (!resourceName) {
    return res.status(400).json({ error: 'resourceName é obrigatório.' });
  }
  try {
    const item = await getResourceByName(resourceName);
    if (!item) {
      return res.status(404).json({ error: 'Recurso não encontrado.' });
    }
    return res.json(item);
  } catch (err) {
    logger.error('Erro ao obter recurso por nome:', err);
    return res.status(500).json({ error: 'Erro ao obter recurso por nome.' });
  }
}

/**
 * PUT /v1/resources/:id
 */
export async function updateResourceController(req, res) {
  const { id } = req.params;
  const { resourceName, status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }
  try {
    const updated = await updateResource(id, { resourceName, status });
    if (!updated) {
      return res.status(404).json({ error: 'Recurso não encontrado.' });
    }
    return res.json(updated);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'resourceName já existente.' });
    }
    logger.error('Erro ao atualizar recurso:', err);
    return res.status(500).json({ error: 'Erro ao atualizar recurso.' });
  }
}

/**
 * DELETE /v1/resources/:id
 */
export async function deleteResourceController(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido.' });
  }
  try {
    const deleted = await deleteResource(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Recurso não encontrado.' });
    }
    return res.json(deleted);
  } catch (err) {
    logger.error('Erro ao deletar recurso:', err);
    return res.status(500).json({ error: 'Erro ao deletar recurso.' });
  }
}
