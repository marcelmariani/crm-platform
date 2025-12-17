// src/services/correspondentService.js
import axios from 'axios';
import config from '../config/config.js';

function baseUrl() {
  // aceita múltiplas envs
  return (
    process.env.APP_BANK_CORRESPONDENT_SERVICE_URL ||
    process.env.CORRESPONDENT_SERVICE_URL ||
    config?.services?.correspondentBaseUrl ||
    ''
  );
}

export async function listCorrespondentsByOwner({ ownerAuthId, authorization, httpsAgent, timeout = 7000 }) {
  const base = String(baseUrl()).trim();
  if (!base || !ownerAuthId) return [];
  const b = base.endsWith('/') ? base : `${base}/`;

  const headers = authorization ? { Authorization: authorization } : undefined;

  // Tenta ?ownerAuthId= e fallback /by-owner/:id
  const candidates = [
    `bank-correspondents?ownerAuthId=${encodeURIComponent(ownerAuthId)}`,
    `bank-correspondents/by-owner/${encodeURIComponent(ownerAuthId)}`,
  ];
  for (const p of candidates) {
    try {
      const url = new URL(p, b).toString();
      const { data } = await axios.get(url, { headers, httpsAgent, timeout });
      return Array.isArray(data) ? data : [data];
    } catch {
      // tenta próximo
    }
  }
  return [];
}
