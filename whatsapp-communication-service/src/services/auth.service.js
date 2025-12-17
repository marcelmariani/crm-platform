import { resilientHttp } from "../utils/resilientHttp.utils.js";
import logger from "../config/logger.js";
import config from "../config/config.js";

// Suporta ambos padrões de ENV
// Base do Auth: agora somente via JWT_SERVICE_URL (unifica nomenclatura)
const AUTH_BASE = (process.env.JWT_SERVICE_URL || "").replace(/\/$/, "");
const LOGIN_PATH =
  process.env.JWT_LOGIN_PATH || "/auth/login";

const USER = process.env.JWT_ADMIN_USERNAME;
const PASS = process.env.JWT_ADMIN_PASS;

function mask(v) {
  if (!v) return "<empty>";
  const len = v.length;
  if (len <= 4) return "*".repeat(len);
  return v.slice(0, 2) + "*".repeat(Math.max(2, len - 4)) + v.slice(-2);
}

if (!AUTH_BASE) logger.warn("[AuthService] Base ausente: JWT_SERVICE_URL");
if (!USER || !PASS) logger.warn("[AuthService] Credenciais ausentes: JWT_ADMIN_USERNAME|JWT_ADMIN_PASS");

let cachedToken = null;
let expiresAt   = 0;

/**
 * Busca um token JWT no Auth Service e cacheia até 1 min antes de expirar.
 * Logs ricos de URL, usuário e latência. Não loga senha nem token puro.
 */
export async function fetchAuthToken() {
  if (cachedToken && Date.now() < expiresAt) return cachedToken;

  const url = `${AUTH_BASE}${LOGIN_PATH.startsWith("/") ? "" : "/"}${LOGIN_PATH}`;
  const start = Date.now();
  
  // Alerta se usando URL externa do Render (deve usar DNS interno)
  if (url.includes('onrender.com') && process.env.NODE_ENV === 'production') {
    logger.warn("[AuthService] ⚠️  Usando URL externa do Render - Configure DNS interno!", {
      url,
      hint: "Use o nome do serviço interno (ex: http://auth-service:3000) para evitar rate limiting e latência"
    });
  }
  
  logger.info("[AuthService] Solicitando token", {
    url,
    user: USER ? USER : "<empty>"
  });

  try {
    const resp = await resilientHttp.post(
      url,
      { userName: USER, password: PASS }
    );

    const token =
      resp.data?.token ?? resp.data?.accessToken ?? resp.data?.access_token;
    if (!token) throw new Error("Auth não retornou token");

    const ttl =
      typeof resp.data?.expiresIn === "number" ? resp.data.expiresIn :
      typeof resp.data?.expires_in === "number" ? resp.data.expires_in :
      typeof resp.data?.expireIn  === "number" ? resp.data.expireIn  : 3600;

    cachedToken = token;
    expiresAt   = Date.now() + ttl * 1000 - 60_000;

    const latency = Date.now() - start;
    logger.info("[AuthService] Token obtido", {
      status: resp.status,
      ttlSeconds: ttl,
      latencyMs: latency
    });
    
    // Alerta se latência muito alta (possível cold start ou comunicação externa)
    if (latency > 30000) {
      logger.warn("[AuthService] ⚠️  Latência muito alta detectada", {
        latencyMs: latency,
        possibleCause: "Cold start do serviço auth ou comunicação via URL externa",
        recommendation: "Verifique se está usando DNS interno do cluster"
      });
    }
    
    return token;

  } catch (err) {
    const latency = Date.now() - start;
    
    // Diagnóstico específico para erro 429 (Rate Limiting)
    if (err?.response?.status === 429) {
      logger.error("[AuthService] ❌ ERRO 429 - Rate Limiting", {
        message: "Muitas requisições ou cold start prolongado",
        latencyMs: latency,
        url,
        solution: "Usar DNS interno ou reduzir concorrência de fetchAuthToken",
        envVar: "JWT_SERVICE_URL"
      });
    }
    
    logger.error("[AuthService] Falha ao obter token", {
      message: err?.message,
      code: err?.code,
      status: err?.response?.status,
      latencyMs: latency,
      url,
      user: USER ? USER : "<empty>",
      bodySnippet: (() => {
        try {
          const d = err?.response?.data;
          const s = typeof d === "string" ? d : JSON.stringify(d);
          return s?.slice(0, 400);
        } catch { return "<unreadable>"; }
      })(),
      latencyMs: Date.now() - start
    });
    throw new Error("Não foi possível obter token de autenticação");
  }
}

/**
 * Login explícito como admin (sem cache), retorna token imediatamente.
 */
export async function loginAsAdmin() {
  const url = `${AUTH_BASE}${LOGIN_PATH}`;
  try {
    logger.debug?.("[AuthImpersonation] Tentando login admin", { url, userName: USER });
    const { data } = await resilientHttp.post(
      url,
      { userName: USER, password: PASS }
    );
    const token = data?.accessToken || data?.token;
    if (!token) throw new Error("Admin login não retornou token");
    logger.debug?.("[AuthImpersonation] Admin login OK");
    return token;
  } catch (e) {
    logger.error("[AuthImpersonation] Falha no login admin", {
      url,
      message: e?.message,
      status: e?.response?.status,
      responseData: e?.response?.data
    });
    throw e;
  }
}

/**
 * Obtém um OBO token para um determinado agente usando o admin token.
 */
export async function getOboTokenForAgent({ agentId, ttlSeconds = 600 }) {
  if (!agentId) throw new Error("agentId é obrigatório para impersonação");

  try {
    const adminToken = await loginAsAdmin();
    const url = `${AUTH_BASE}/auth/impersonate`;
    const payload = { agentId, ttlSeconds };

    logger.debug?.("[AuthImpersonation] Solicitando OBO token", { url, payload });

    const { data } = await resilientHttp.post(
      url,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`
        }
      }
    );

    const obo = data?.accessToken || data?.token;
    if (!obo) throw new Error("Impersonate não retornou token");

    logger.info("[AuthImpersonation] OBO token obtido", { agentId });
    return obo;
  } catch (e) {
    logger.error("[AuthImpersonation] Falha ao obter OBO token", {
      url: `${AUTH_BASE}/auth/impersonate`,
      agentId,
      message: e?.message,
      status: e?.response?.status,
      responseData: e?.response?.data
    });
    throw e;
  }
}
export default fetchAuthToken;
