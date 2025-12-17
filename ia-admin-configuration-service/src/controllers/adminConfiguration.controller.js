// src/controllers/adminConfiguration.controller.js
import * as configurationService from '../services/adminConfiguration.service.js';

export const createAdminConfiguration = async (req, res) => {
  try {
    const created = await configurationService.createAdminConfiguration(req.body, {
      authHeader: req.headers.authorization,
    });
    return res.status(201).json(created);
  } catch (err) {
    const status = err?.status || err?.response?.status;

    if (status === 404 && /bank/i.test(err.message || '')) {
      return res.status(400).json({ error: 'idBank inválido' });
    }
    if (status === 409) {
      return res.status(409).json({ error: 'duplicate', detail: err.message });
    }
    if (err?.response?.status) {
      return res
        .status(502)
        .json({ error: 'bank_service_error', status: err.response.status });
    }
    return res.status(500).json({ error: 'internal_error', detail: err.message });
  }
};

export async function getAdminConfigurations(_req, res, next) {
  try {
    const configs = await configurationService.getAllAdminConfigurations();
    return res.status(200).json(configs);
  } catch (error) {
    next(error);
  }
}

export async function getAdminConfigurationById(req, res, next) {
  try {
    const { id } = req.params;
    const config = await configurationService.getAdminConfigurationById(id);
    return res.status(200).json(config);
  } catch (error) {
    next(error);
  }
}

export async function updateAdminConfiguration(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await configurationService.updateAdminConfiguration(id, req.body, {
      authHeader: req.headers.authorization,
    });
    return res.status(200).json(updated);
  } catch (error) {
    next(error);
  }
}

export async function deleteAdminConfiguration(req, res, next) {
  try {
    const { id } = req.params;
    await configurationService.deleteAdminConfiguration(id);
    return res.status(204).send();
  } catch (error) {
    next(error);
  }
}
