import axios from 'axios';
import https from 'https';
import config from '../config/adminConfiguration.config.js';

const agent = new https.Agent({ rejectUnauthorized: !config.skipTlsVerify });

export function bankApi(token) {
  if (!config.services.bankBaseUrl) {
    throw new Error('BANK_SERVICE_URL não configurado');
  }
  return axios.create({
    baseURL: config.services.bankBaseUrl.replace(/\/+$/, ''), // .../v1
    timeout: 7000,
    httpsAgent: agent,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

export async function assertBankExists(id, token) {
  const api = bankApi(token);
  const { data } = await api.get(`/banks/${encodeURIComponent(id)}`);
  return data; // lança 404 se não existir
}
