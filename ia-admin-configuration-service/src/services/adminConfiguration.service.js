// src/services/adminConfiguration.service.js
import mongoose from 'mongoose';
import AdminConfiguration from '../models/adminConfiguration.model.js';
import logger from '../config/adminConfiguration.logger.js';
import { assertBankExists } from '../clients/adminConfiguration.bank.client.js';

const mapStatus = (s) => {
  const m = { ativo: 'active', inativo: 'inactive', active: 'active', inactive: 'inactive' };
  return m[String(s ?? 'active').toLowerCase()] || 'active';
};

const bearerToToken = (h) => (h || '').replace(/^Bearer\s+/i, '');

function normalizePayload(p) {
  const out = { ...p };
  if (out.status) out.status = mapStatus(out.status);
  if (typeof out.name === 'string') out.name = out.name.trim();
  if (typeof out.prompt === 'string') out.prompt = out.prompt.trim();
  if (typeof out.creditRules === 'string') out.creditRules = out.creditRules.trim();
  return out;
}

/**
 * Cria uma nova configuração de prompt de IA.
 * @param {Object} data
 * @param {Object} [opts] { authHeader?: string }
 */
export async function createAdminConfiguration(data, opts = {}) {
  const token = bearerToToken(opts.authHeader);
  if (!mongoose.Types.ObjectId.isValid(data.idBank)) {
    const err = new Error('idBank inválido');
    err.status = 400;
    throw err;
  }
  await assertBankExists(data.idBank, token);

  try {
    const doc = await AdminConfiguration.create(normalizePayload(data));
    logger.info('AdminConfiguration criada', { id: doc._id.toString() });
    return doc;
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('Já existe configuração com este name para o mesmo idBank');
      err.status = 409;
      throw err;
    }
    logger.error('Falha ao criar AdminConfiguration', { error: error.message });
    throw error;
  }
}

/** Lista todas as configurações. */
export async function getAllAdminConfigurations() {
  const list = await AdminConfiguration.find().lean();
  logger.info('Listagem AdminConfiguration', { count: list.length });
  return list;
}

/** Busca por ID. */
export async function getAdminConfigurationById(id) {
  const doc = await AdminConfiguration.findById(id).lean();
  if (!doc) {
    const err = new Error('Configuração não encontrado');
    err.status = 404;
    throw err;
  }
  return doc;
}

/**
 * Atualiza uma configuração.
 * @param {String} id
 * @param {Object} data
 * @param {Object} [opts] { authHeader?: string }
 */
export async function updateAdminConfiguration(id, data, opts = {}) {
  const token = bearerToToken(opts.authHeader);

  if (data?.idBank) {
    if (!mongoose.Types.ObjectId.isValid(data.idBank)) {
      const err = new Error('idBank inválido');
      err.status = 400;
      throw err;
    }
    await assertBankExists(data.idBank, token);
  }

  try {
    const updated = await AdminConfiguration.findByIdAndUpdate(
      id,
      normalizePayload(data),
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      const err = new Error('Configuração não encontrada para atualização');
      err.status = 404;
      throw err;
    }
    logger.info('AdminConfiguration atualizada', { id });
    return updated;
  } catch (error) {
    if (error?.code === 11000) {
      const err = new Error('Conflito de unicidade (name + idBank)');
      err.status = 409;
      throw err;
    }
    logger.error('Falha ao atualizar AdminConfiguration', { error: error.message });
    throw error;
  }
}

/** Remove por ID. */
export async function deleteAdminConfiguration(id) {
  const deleted = await AdminConfiguration.findByIdAndDelete(id).lean();
  if (!deleted) {
    const err = new Error('Configuração não encontrada para remoção');
    err.status = 404;
    throw err;
  }
  logger.info('AdminConfiguration removida', { id });
  return deleted;
}
