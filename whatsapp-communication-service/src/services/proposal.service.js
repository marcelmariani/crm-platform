import { createResilientHttpClient } from "../utils/resilientHttp.utils.js";
import logger from "../config/logger.js";

const trunc = (obj, n = 600) => {
  try { const s = typeof obj === "string" ? obj : JSON.stringify(obj); return s.length > n ? s.slice(0, n) + "…" : s; }
  catch { return String(obj); }
};

function parseProductMap() {
  try {
    let raw = process.env.PROPOSAL_PRODUCT_MAP || "";
    if (!raw) return {};
    // aceita .env com aspas simples ao redor
    raw = raw.trim().replace(/^'+|'+$/g, "");
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

function extractCreditLineText(cd) {
  if (!cd) return null;
  const candidates = [
    'linhaCredito', 'linhaDeCredito', 'linha_de_credito', 'creditLine',
    'linhaCreditoDescricao', 'descricaoLinhaCredito', 'descricao_linha_credito',
    'linha', 'linha_de_credito_texto'
  ];
  for (const k of candidates) {
    if (cd[k] != null && cd[k] !== '') return String(cd[k]);
  }
  return null;
}

// Função exportada para criação de proposta
export async function createProposal(collectedData, token) {
  const base = (process.env.APP_SALES_SERVICE_URL || process.env.SERVICE_PROPOSAL_URL || "").replace(/\/$/, "");
  if (!base) {
    logger.warn("[Proposal] APP_SALES_SERVICE_URL ausente; ignorando criação de proposta");
    return null;
  }
  try {
    const parseNumber = (v) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return v;
      const s = String(v).trim();
      if (/^\d+,\d{1,2}$/.test(s)) return Number(s.replace(',', '.'));
      const cleaned = s
        .replace(/[^\d.,-]/g, '')
        .replace(/,(?=\d{3}\b)/g, '')
        .replace(/,/g, '.');
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    };

    const toCents = (v) => {
      const n = parseNumber(v);
      if (Number.isInteger(n) && n >= 1_000_000 && n % 100 === 0) {
        return n; // já parece estar em centavos
      }
      return Math.round(n * 100);
    };
    const cd = collectedData || {};
    const valorImovelCents = toCents(cd.valorImovel ?? cd.unitPrice ?? cd.amount);
    const valorEntradaCents = toCents(cd.valorEntrada ?? cd.downPayment);
    const amount = valorImovelCents;
    const unitPrice = valorImovelCents;
    const downPayment = valorEntradaCents;

    const financingTypeMap = (v) => {
      switch (String(v)) {
        case '1': return 'sbpe';
        case '2': return 'vinculado';
        case '3': return 'fgts';
        default: return String(v || '').toLowerCase();
      }
    };
    const purposeMap = (v) => {
      switch (String(v)) {
        case '1': return 'purchase';
        case '4': return 'purchase';
        case '2': return 'construction';
        case '3': return 'renovation';
        case '6': return 'land';
        case '7': return 'loan_property_guarantee';
        case '11': return 'purchase_caixa';
        default: return 'purchase';
      }
    };
    const financingType = financingTypeMap(cd.tipoFinanciamento);
    const purpose = purposeMap(cd.finalidade);

    const creditLineText = extractCreditLineText(cd);
    const map = parseProductMap();
    const productIdFromMap = creditLineText ? (map[creditLineText] || map[String(creditLineText).toLowerCase()] || null) : null;

    const buyerIds = [];
    if (cd.buyerId) buyerIds.push(String(cd.buyerId));
    if (Array.isArray(cd.buyerIds)) buyerIds.push(...cd.buyerIds.map(String));

    const url = `${base}/proposals`;
    const body = {
      ...(buyerIds.length ? { buyerId: buyerIds } : {}),
      products: [
        {
          ...(productIdFromMap || cd.productId || cd.produtoId || cd.imovelId ? { productId: String(productIdFromMap || cd.productId || cd.produtoId || cd.imovelId) } : {}),
          ...(creditLineText ? { description: creditLineText } : {}),
          amount,
          downPayment,
          financingType,
          purpose,
          unitPrice,
          clientHasProperty: !!cd.clientHasProperty,
          requestPortability: !!cd.requestPortability,
          authorizeLGPD: true,
          requestBankRelationship: !!cd.requestBankRelationship,
          useFGTS: financingType === 'fgts' || !!cd.useFGTS,
          clientBenefitedFGTS: !!cd.clientBenefitedFGTS
        }
      ]
    };
    if (!body.products[0].productId && creditLineText) {
      const mapLower = Object.fromEntries(Object.entries(map).map(([k,v]) => [String(k).toLowerCase(), v]));
      const alt = mapLower[String(creditLineText).toLowerCase()];
      if (alt) body.products[0].productId = String(alt);
    }

    const proposalHttp = createResilientHttpClient();
    proposalHttp.interceptors.request.use(cfg => {
      cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      cfg.metadata = { start: Date.now() };
      return cfg;
    });
    proposalHttp.interceptors.response.use(
      r => r,
      e => {
        logger.error('[Proposal] ×', {
          url: e?.config?.url,
          status: e?.response?.status,
          latencyMs: Date.now() - (e?.config?.metadata?.start || Date.now()),
          dataSnippet: trunc(e?.response?.data)
        });
        return Promise.reject(e);
      }
    );

    logger.info('[Proposal] Criando proposta', { url, snippet: trunc(body, 300), creditLineText, productIdFromMap });
    const { data } = await proposalHttp.post(url, body);
    logger.info('[Proposal] Proposta criada', { id: data?.id || data?._id, snippet: trunc(data, 300) });
    return data;
  } catch (e) {
    logger.warn('[Proposal] Falha ao criar proposta', { msg: e?.message });
    return null;
  }
}
