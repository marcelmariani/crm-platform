// src/services/realEstateService.js
import axios from 'axios';
import config from '../config/config.js';

function baseUrl() {
  return (
    process.env.RE_SERVICE_URL ||
    process.env.REAL_ESTATE_SERVICE_URL ||
    config?.services?.realEstateBaseUrl ||
    ''
  );
}

/**
 * Retorna [{ _id, ... }] de imobiliárias cujo ownerAuthId == informado.
 * Requer rota GET /real-estates?ownerAuthId=:sub (adicionar no real-estate-service se ainda não existir).
 */
export async function listRealEstatesByOwner({ ownerAuthId, authorization, httpsAgent, timeout = 7000 }) {
  const base = String(baseUrl()).trim();
  if (!base || !ownerAuthId) return [];
  const b = base.endsWith('/') ? base : `${base}/`;
  const headers = authorization ? { Authorization: authorization } : undefined;

  const url = new URL(`real-estates?ownerAuthId=${encodeURIComponent(ownerAuthId)}`, b).toString();
  try {
    const { data } = await axios.get(url, { headers, httpsAgent, timeout });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
