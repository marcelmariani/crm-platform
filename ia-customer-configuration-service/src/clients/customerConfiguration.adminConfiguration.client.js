// src/clients/customerConfiguration.adminConfiguration.client.js
import axios from 'axios';
import https from 'https';
import { AppError } from '../middlewares/customerConfiguration.errorHandler.js';

const BASE = (process.env.APP_IA_ADMIN_CONFIGURATION_SERVICE_URL || '').replace(/\/+$/,''); // ex: https://localhost:3013/v1
const RESOURCE = (process.env.IA_ADMIN_CONFIGURATION_RESOURCE_PATH || '/ia-admin-configurations').replace(/^\/+|\/+$/g,'');

const skipTls = ['development','staging'].includes(process.env.NODE_ENV) || String(process.env.SKIP_TLS_VERIFY).toLowerCase() === 'true';
const httpsAgent = new https.Agent({ rejectUnauthorized: !skipTls });

function urlFor(id) {
  return new URL(`${RESOURCE}/${encodeURIComponent(id)}`, BASE + '/').toString();
}

export async function ensureAdminConfigExists(id, authHeader) {
  if (!BASE) throw new AppError('config_error', 500, 'APP_IA_ADMIN_CONFIGURATION_SERVICE_URL não configurada');
  const url = urlFor(id);
  try {
    await axios.get(url, { headers: authHeader ? { Authorization: authHeader } : {}, httpsAgent, timeout: 7000 });
    return true;
  } catch (err) {
    const st = err?.response?.status;
    if (st === 404) throw new AppError('invalid_reference', 400, 'idAdminConfiguration inexistente no ia-admin-configuration-service');
    if (st === 401 || st === 403) throw new AppError('upstream_unauthorized', 502, 'Não autorizado no ia-admin-configuration-service');
    throw new AppError('http_error', 502, err?.response?.data?.message || err?.message || 'Falha ao consultar ia-admin-configuration-service');
  }
}
