// File: src/services/customerConfiguration.service.js
import axios from 'axios';
import https from 'https';
import createError from 'http-errors';
import logger from '../config/customerConfiguration.logger.js';
import { CustomerConfiguration } from '../models/customerConfiguration.model.js';

// .env:
// APP_IA_ADMIN_CONFIGURATION_SERVICE_URL=https://localhost:3013/v1
// IA_ADMIN_CONFIGURATION_RESOURCE_PATH=/ia-admin-configurations
const ADMIN_BASE = (process.env.APP_IA_ADMIN_CONFIGURATION_SERVICE_URL || '').replace(/\/+$/,'');
const ADMIN_RESOURCE = (process.env.IA_ADMIN_CONFIGURATION_RESOURCE_PATH || '/ia-admin-configurations')
  .replace(/^\/+|\/+$/g, '');

const redactToken = h => {
  if (!h) return '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return h;
  const t = m[1];
  return `Bearer ${t.length > 16 ? `${t.slice(0,6)}...${t.slice(-6)}` : '<redacted>'}`;
};
const curlForGet = (url, headers = {}) => {
  const lines = [`curl --location --globoff '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    lines.push(`--header '${k}: ${k.toLowerCase()==='authorization' ? redactToken(v) : v}'`);
  }
  return lines.join(' \\\n');
};

function adminConfigUrl(id) {
  // Resultado: https://localhost:3013/v1/ia-admin-configurations/:id
  return new URL(`${ADMIN_RESOURCE}/${encodeURIComponent(id)}`, ADMIN_BASE + '/').toString();
}

async function ensureAdminConfigExists(idAdminConfiguration, authHeader) {
  if (!idAdminConfiguration) { const e = new Error('idAdminConfiguration é obrigatório'); e.status = 400; throw e; }
  if (!/^https?:\/\//i.test(ADMIN_BASE)) { const e = new Error('APP_IA_ADMIN_CONFIGURATION_SERVICE_URL inválida'); e.status = 500; throw e; }

  const skipTls =
    String(process.env.SKIP_TLS_VERIFY || '').toLowerCase() === 'true' ||
    ['development', 'staging'].includes(process.env.NODE_ENV);
  const httpsAgent = new https.Agent({ rejectUnauthorized: !skipTls });

  const url = adminConfigUrl(idAdminConfiguration);
  const headers = authHeader ? { Authorization: authHeader } : {};
  const curl = curlForGet(url, headers);

  logger.info(`admin-config.request.curl\n${curl}`);
  try {
    const resp = await axios.get(url, { headers, httpsAgent, timeout: 7000 });
    logger.info(`admin-config.response status=${resp.status} url=${url}`);
  } catch (err) {
    logger.error(`admin-config.error status=${err?.response?.status} url=${url}\nrepro cURL:\n${curl}`);
    if (err?.response?.status === 404) { const e = new Error('idAdminConfiguration inexistente no ia-admin-configuration-service'); e.status = 400; throw e; }
    if ([401,403].includes(err?.response?.status)) { const e = new Error('Não autorizado no ia-admin-configuration-service'); e.status = 502; throw e; }
    const e = new Error('Falha ao consultar ia-admin-configuration-service'); e.status = 502; throw e;
  }
}

// ===== CRUD (inalterado exceto chamadas a ensureAdminConfigExists) =====
export async function createCustomerConfiguration(data, authHeader) {
  await ensureAdminConfigExists(data.idAdminConfiguration, authHeader);
  if (data.status === 'active') {
    const exists = await CustomerConfiguration.findOne({ whatsappPhoneNumber: data.whatsappPhoneNumber, status: 'active' });
    if (exists) throw createError(409, `Já existe uma configuração ATIVA para ${data.whatsappPhoneNumber}`);
  }
  return CustomerConfiguration.create(data);
}

export async function getCustomerConfigurations() { return CustomerConfiguration.find(); }
export async function getCustomerConfigurationById(id) { return CustomerConfiguration.findById(id); }

export async function updateCustomerConfiguration(id, data, authHeader) {
  const config = await CustomerConfiguration.findById(id);
  if (!config) throw createError(404, 'Registro não encontrado');
  const turningInactive = data.status === 'inactive' && config.status === 'active';
  if (config.status === 'active' && !turningInactive) throw createError(400, 'Configuração ativa não pode ser alterada; apenas inativação é permitida.');
  await ensureAdminConfigExists(data.idAdminConfiguration, authHeader);
  if (data.status === 'active') {
    const conflict = await CustomerConfiguration.findOne({ whatsappPhoneNumber: config.whatsappPhoneNumber, status: 'active', _id: { $ne: config._id } });
    if (conflict) throw createError(409, `Já existe outra configuração ATIVA para ${config.whatsappPhoneNumber}`);
  }
  Object.assign(config, data);
  return config.save();
}

export async function deleteCustomerConfiguration(id) {
  const config = await CustomerConfiguration.findById(id);
  if (!config) throw createError(404, 'Registro não encontrado');
  if (config.status === 'active') throw createError(400, 'Não é permitido excluir registro ativo. Primeiro inative-o.');
  return CustomerConfiguration.deleteOne({ _id: id });
}

export async function getCustomerConfigurationByPhone(whatsappPhoneNumber) {
  return CustomerConfiguration.find({ whatsappPhoneNumber });
}

export async function updateCustomerConfigurationByPhone(whatsappPhoneNumber, data, authHeader) {
  const config = await CustomerConfiguration.findOne({ whatsappPhoneNumber });
  if (!config) throw createError(404, 'Registro não encontrado');
  const turningInactive = data.status === 'inactive' && config.status === 'active';
  if (config.status === 'active' && !turningInactive) throw createError(400, 'Configuração ativa não pode ser alterada; apenas inativação é permitida.');
  await ensureAdminConfigExists(data.idAdminConfiguration, authHeader);
  if (data.status === 'active') {
    const conflict = await CustomerConfiguration.findOne({ whatsappPhoneNumber, status: 'active', _id: { $ne: config._id } });
    if (conflict) throw createError(409, `Já existe outra configuração ATIVA para ${whatsappPhoneNumber}`);
  }
  Object.assign(config, data);
  return config.save();
}

export async function deleteCustomerConfigurationByPhone(whatsappPhoneNumber) {
  const config = await CustomerConfiguration.findOne({ whatsappPhoneNumber });
  if (!config) throw createError(404, 'Registro não encontrado');
  if (config.status === 'active') throw createError(400, 'Não é permitido excluir registro ativo. Primeiro inative-o.');
  return CustomerConfiguration.deleteOne({ whatsappPhoneNumber });
}
