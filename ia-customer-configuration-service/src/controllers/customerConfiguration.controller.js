// src/controllers/customerConfigurationController.js
import * as service from '../services/customerConfiguration.service.js';

/** Cria uma nova configuração de IA para o cliente. */
export async function createCustomerConfiguration(req, res, next) {
  try {
    const created = await service.createCustomerConfiguration(
      req.body,
      req.headers.authorization
    );
    return res.status(201).json(created);
  } catch (err) {
    next(err);
  }
}

/** Lista todas as configurações de IA do cliente. */
export async function getCustomerConfigurations(req, res, next) {
  try {
    const configs = await service.getCustomerConfigurations();
    return res.status(200).json(configs);
  } catch (err) {
    next(err);
  }
}

/** Recupera uma configuração pelo ID. */
export async function getCustomerConfigurationById(req, res, next) {
  try {
    const config = await service.getCustomerConfigurationById(req.params.id);
    if (!config) {
      const error = new Error('Configuração não encontrada.');
      error.status = 404;
      throw error;
    }
    return res.status(200).json(config);
  } catch (err) {
    next(err);
  }
}

/** Atualiza uma configuração existente pelo ID. */
export async function updateCustomerConfiguration(req, res, next) {
  try {
    const { id } = req.params;
    const existing = await service.getCustomerConfigurationById(id);

    if (existing?.status === 'active' && req.body.status !== 'inactive') {
      const error = new Error(
        'Configuração ativa não pode ser alterada; apenas inativação é permitida.'
      );
      error.status = 400;
      throw error;
    }

    const updated = await service.updateCustomerConfiguration(
      id,
      req.body,
      req.headers.authorization
    );
    if (!updated) {
      const error = new Error('Configuração não encontrada para atualização.');
      error.status = 404;
      throw error;
    }
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

/** Remove uma configuração pelo ID. */
export async function deleteCustomerConfiguration(req, res, next) {
  try {
    const deleted = await service.deleteCustomerConfiguration(req.params.id);
    if (!deleted) {
      const error = new Error('Configuração não encontrada para exclusão.');
      error.status = 404;
      throw error;
    }
    return res.status(200).json(deleted);
  } catch (err) {
    next(err);
  }
}

/** Recupera todas as configurações associadas a um número de WhatsApp. */
export async function getCustomerConfigurationByPhone(req, res, next) {
  try {
    const { whatsappPhoneNumber } = req.params;
    const configs = await service.getCustomerConfigurationByPhone(whatsappPhoneNumber);
    if (!configs.length) {
      const error = new Error(
        `Nenhuma configuração encontrada para '${whatsappPhoneNumber}'.`
      );
      error.status = 404;
      throw error;
    }
    return res.status(200).json(configs);
  } catch (err) {
    next(err);
  }
}

/** Atualiza a configuração associada a um número de WhatsApp. */
export async function updateCustomerConfigurationByPhone(req, res, next) {
  try {
    const { whatsappPhoneNumber } = req.params;
    const [existing] = await service.getCustomerConfigurationByPhone(whatsappPhoneNumber);

    if (existing?.status === 'active' && req.body.status !== 'inactive') {
      const error = new Error(
        'Configuração ativa não pode ser alterada; apenas inativação é permitida.'
      );
      error.status = 400;
      throw error;
    }

    const updated = await service.updateCustomerConfigurationByPhone(
      whatsappPhoneNumber,
      req.body,
      req.headers.authorization
    );
    if (!updated) {
      const error = new Error(
        `Configuração para '${whatsappPhoneNumber}' não encontrada para atualização.`
      );
      error.status = 404;
      throw error;
    }
    return res.status(200).json(updated);
  } catch (err) {
    next(err);
  }
}

/** Exclui a configuração associada a um número de WhatsApp. */
export async function deleteCustomerConfigurationByPhone(req, res, next) {
  try {
    const { whatsappPhoneNumber } = req.params;
    const deleted = await service.deleteCustomerConfigurationByPhone(whatsappPhoneNumber);
    if (!deleted) {
      const error = new Error(
        `Configuração para '${whatsappPhoneNumber}' não encontrada para exclusão.`
      );
      error.status = 404;
      throw error;
    }
    return res.status(200).json(deleted);
  } catch (err) {
    next(err);
  }
}
