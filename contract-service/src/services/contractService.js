// src/services/contractService.js
import Contract from '../models/contractModel.js';
import { AppError } from '../middlewares/errorHandler.js';

const toURL = (base, path) => `${String(base || '').replace(/\/+$/, '')}${path}`;

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const body = await safeJson(res);
    const msg = body?.message || body?.detail || `HTTP ${res.status}`;
    const code = body?.code || body?.error || 'http_error';
    throw new AppError(code, res.status, msg);
  }
  return res.json();
}

function isActiveLike(val) {
  if (val == null) return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'string') return val.toLowerCase() === 'active';
  if (Array.isArray(val)) {
    const first = val[0];
    return isActiveLike(first?.status ?? first);
  }
  if (typeof val === 'object') {
    if (typeof val.isActive === 'boolean') return val.isActive;
    if (val.status !== undefined) return isActiveLike(val.status);
    if (val.statusState !== undefined) return isActiveLike(val.statusState);
  }
  return false;
}

export async function createcontract({ buyerId, sellerId, products, ownerAuthId, bearer }) {
  const PRODUCT_URL = process.env.PRODUCT_SERVICE_URL;
  const CONTACT_URL = process.env.CONTACT_SERVICE_URL;
  const SELLER_URL  = process.env.SELLER_SERVICE_URL;
  if (!PRODUCT_URL || !CONTACT_URL || !SELLER_URL) {
    throw new AppError('service_urls_not_configured', 500, 'Missing PRODUCT_SERVICE_URL or CONTACT_SERVICE_URL or SELLER_SERVICE_URL');
  }

  if (!Array.isArray(buyerId) || buyerId.length === 0)  throw new AppError('buyers_required', 400, 'buyerId must be a non-empty array');
  if (!Array.isArray(sellerId) || sellerId.length === 0) throw new AppError('sellers_required', 400, 'sellerId must be a non-empty array');
  if (!Array.isArray(products) || products.length === 0) throw new AppError('products_required', 400, 'Products list required');

  for (const bid of buyerId) {
    const contact = await fetchJSON(toURL(CONTACT_URL, `/v1/contacts/${bid}`), { headers: { Authorization: bearer } });
    const cType = String(contact?.type || '').toLowerCase();
    const cActive = isActiveLike(contact);
    if (cType !== 'client') throw new AppError('contact_must_be_client', 422, `Buyer ${bid} is not client`);
    if (!cActive) throw new AppError('contact_inactive', 422, `Buyer ${bid} inactive`);
  }

  for (const sid of sellerId) {
    const seller = await fetchJSON(toURL(SELLER_URL, `/v1/sellers/${sid}`), { headers: { Authorization: bearer } });
    const sActive = isActiveLike(seller);
    if (!sActive) throw new AppError('seller_inactive', 422, `Seller ${sid} inactive`);
  }

  for (const p of products) {
    const prod = await fetchJSON(toURL(PRODUCT_URL, `/v1/products/${p.productId}`), { headers: { Authorization: bearer } });
    const pActive = isActiveLike(prod);
    if (!pActive) throw new AppError('product_inactive', 422, `Product ${p.productId} inactive`);
  }

  const now = new Date();
  const doc = await Contract.create({
    buyerId,
    sellerId,
    products,
    status: [{ status: 'draft', statusStartedAt: now }],
    auditInformation: [{ createdByAuthId: ownerAuthId, createdAt: now, updatedAt: now }],
  });

  return doc.toObject();
}
