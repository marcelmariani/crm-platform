// src/services/authService.js
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import https from 'https';
import User from '../models/user.model.js';
import Group from '../models/group.model.js';
import logger from '../config/auth.logger.js';
import config from '../config/auth.config.js';

/* ===== Endpoints e integrações ===== */
const AGENT_URL = (process.env.APP_AGENT_SERVICE_URL || "").replace(/\/+$/,"");
const RE_URL    = (process.env.APP_REAL_ESTATE_SERVICE_URL || "").replace(/\/+$/,"");
const BC_URL    = (process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || "").replace(/\/+$/,"");

/* ===== HTTP/TLS ===== */
// Keep-alive reduz custo de cold start de conexões TLS e melhora latência
const httpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, keepAliveMsecs: 1000 });
const http = axios.create({ httpsAgent, timeout: 10000 });
const httpAuth = axios.create({ httpsAgent, timeout: 8000 }); // Axios separado para autenticação

// Interceptor simples de retry curto para erros transitórios (máx 1 tentativa extra)
http.interceptors.response.use(undefined, async (error) => {
  const cfg = error.config || {};
  if (cfg.__retried) throw error;
  const status = error?.response?.status;
  // Retry apenas em 502/503/504 e ETIMEDOUT/ECONNRESET
  const transient = [502,503,504].includes(status) || /ETIMEDOUT|ECONNRESET/i.test(error?.code || '');
  if (transient) {
    cfg.__retried = true;
    await new Promise(r => setTimeout(r, 300));
    return http.request(cfg);
  }
  throw error;
});

// Cache do token admin
let adminTokenCache = null;
let adminTokenExpiry = 0;

/* ===== Buscar token admin ===== */
async function getAdminToken() {
  // Retornar token em cache se ainda válido
  if (adminTokenCache && Date.now() < adminTokenExpiry) {
    return adminTokenCache;
  }

  try {
    const loginUrl = `${config.jwt.serviceUrl}${config.jwt.loginPath}`;
    const credentials = {
      userName: config.jwt.adminUsername,
      password: config.jwt.adminPass
    };

    logger.debug?.("[AUTH] Buscando token admin", { loginUrl, userName: credentials.userName });
    
    // Usar httpAuth para evitar interceptor recursivo
    const { data } = await httpAuth.post(loginUrl, credentials);
    const token = data?.token || data?.accessToken || data;
    
    if (token) {
      adminTokenCache = token;
      // Considerar token válido por 50 minutos (para renovar antes de expirar)
      adminTokenExpiry = Date.now() + (50 * 60 * 1000);
      logger.info("[AUTH] Token admin obtido com sucesso");
      return token;
    }
    
    throw new Error("Token não retornado na resposta de login");
  } catch (error) {
    logger.error("[AUTH] Erro ao obter token admin", { 
      message: error?.message,
      status: error?.response?.status 
    });
    throw error;
  }
}

/* ===== Interceptor para adicionar token nas requisições ===== */
http.interceptors.request.use(async (config) => {
  try {
    const token = await getAdminToken();
    config.headers.Authorization = `Bearer ${token}`;
  } catch (error) {
    logger.warn("[AUTH] Não foi possível adicionar token admin na requisição", { 
      url: config.url 
    });
  }
  return config;
});

/* ===== Utilidades ===== */
function isActive(x) {
  const s = String(x?.status || x?.situacao || "").toLowerCase();
  return ["ativo","active","enabled","true","1"].includes(s);
}

const toCandidates = (d) => {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.items)) return d.items;
  if (d?.data) return Array.isArray(d.data) ? d.data : [d.data];
  return [d];
};

/* ===== Buscar Agent por userId ===== */
async function fetchAgentByUserId(userId) {
  if (!userId || !AGENT_URL) {
    logger.warn("[AUTH] UserId ou AGENT_URL ausente", { userId, AGENT_URL });
    return null;
  }
  
  const url = `${AGENT_URL}/agents/by-owner/${userId}`;
  
  try {
    logger.debug?.("[AUTH] Buscando agente", { url, userId });
    const { data } = await http.get(url);
    logger.debug?.("[AUTH] Resposta recebida", { 
      url, 
      dataType: Array.isArray(data) ? 'array' : typeof data,
      length: Array.isArray(data) ? data.length : 'N/A',
      sample: JSON.stringify(data).substring(0, 200)
    });
    const candidates = toCandidates(data);
    const agent = candidates.find(a => isActive(a));
    if (agent) {
      logger.info("[AUTH] Agente encontrado", { agentId: agent.id || agent._id, userId });
      return agent;
    }
    logger.debug?.("[AUTH] Nenhum agente ativo encontrado nos candidatos", { 
      candidatesCount: candidates.length 
    });
  } catch (e) {
    logger.warn("[AUTH] Erro ao buscar agente", { 
      url, 
      status: e?.response?.status,
      statusText: e?.response?.statusText,
      message: e?.message
    });
  }
  return null;
}

/* ===== Buscar Real Estates ===== */
async function fetchRealEstates(ids = []) {
  if (!ids?.length || !RE_URL) return [];
  
  // Tentar busca em batch primeiro
  if (ids.length > 1) {
    const batch = `${RE_URL}/real-estates?ids=${encodeURIComponent(ids.join(","))}`;
    try {
      logger.debug?.("[AUTH] Buscando imobiliárias (batch)", { count: ids.length });
      const { data } = await http.get(batch);
      const arr = Array.isArray(data) ? data : (data?.items || []);
      if (arr.length) return arr;
    } catch (e) {
      logger.debug?.("[AUTH] Batch falhou", { status: e?.response?.status });
    }
  }
  
  // Fallback: busca individual
  const out = [];
  for (const id of ids) {
    const url = `${RE_URL}/real-estates/${id}`;
    try {
      const { data } = await http.get(url);
      if (data) out.push(data);
    } catch (e) {
      logger.debug?.("[AUTH] Real estate não encontrada", { id });
    }
  }
  return out;
}

/* ===== Buscar Bank Correspondents ===== */
async function fetchBankCorrespondents(ids = []) {
  if (!ids?.length || !BC_URL) return [];
  
  // Tentar busca em batch primeiro
  if (ids.length > 1) {
    const batch = `${BC_URL}/bank-correspondents?ids=${encodeURIComponent(ids.join(","))}`;
    try {
      logger.debug?.("[AUTH] Buscando correspondentes (batch)", { count: ids.length });
      const { data } = await http.get(batch);
      const arr = Array.isArray(data) ? data : (data?.items || []);
      if (arr.length) return arr;
    } catch (e) {
      logger.debug?.("[AUTH] Batch falhou", { status: e?.response?.status });
    }
  }
  
  // Fallback: busca individual
  const out = [];
  for (const id of ids) {
    const url = `${BC_URL}/bank-correspondents/${id}`;
    try {
      const { data } = await http.get(url);
      if (data) out.push(data);
    } catch (e) {
      logger.debug?.("[AUTH] Correspondente não encontrado", { id });
    }
  }
  return out;
}

/* ===== Identificar agentId, realEstateId e bankCorrespondentId por userId ===== */
async function identifyUserRelations(userId) {
  try {
    const agent = await fetchAgentByUserId(userId);
    if (!agent || !isActive(agent)) {
      logger.debug("[AUTH] Agente não encontrado ou inativo", { userId });
      return { agentId: null, realEstateId: null, bankCorrespondentId: null };
    }

    const agentId = agent.id || agent._id;
    const reList = await fetchRealEstates(agent.realEstateIds || []);
    const reActives = reList.filter(isActive);
    
    if (!reActives.length) {
      logger.debug("[AUTH] Nenhuma imobiliária ativa", { agentId });
      return { agentId: agentId?.toString(), realEstateId: null, bankCorrespondentId: null };
    }

    const realEstateId = reActives[0].id || reActives[0]._id;
    const bcIds = reActives.flatMap(r => r.bankCorrespondentIds || []);
    const bcList = await fetchBankCorrespondents(bcIds);
    const bcActives = bcList.filter(isActive);
    
    if (!bcActives.length) {
      logger.debug("[AUTH] Nenhum correspondente ativo", { agentId, realEstateId });
      return { 
        agentId: agentId?.toString(), 
        realEstateId: realEstateId?.toString(), 
        bankCorrespondentId: null 
      };
    }

    const bankCorrespondentId = bcActives[0].id || bcActives[0]._id;
    
    logger.info("[AUTH] Relações identificadas", { 
      userId, 
      agentId: agentId?.toString(), 
      realEstateId: realEstateId?.toString(), 
      bankCorrespondentId: bankCorrespondentId?.toString() 
    });

    return {
      agentId: agentId?.toString(),
      realEstateId: realEstateId?.toString(),
      bankCorrespondentId: bankCorrespondentId?.toString()
    };
  } catch (error) {
    logger.error("[AUTH] Erro ao identificar relações do usuário", { 
      userId, 
      error: error?.message 
    });
    return { agentId: null, realEstateId: null, bankCorrespondentId: null };
  }
}

export async function authenticateUser(userName, password) {
  const user = await User.findOne({ userName });
  if (!user || user.status !== 'active') {
    logger.warn(`Login falhou: usuário não encontrado ou inativo (${userName})`);
    throw new Error('Credenciais inválidas');
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    logger.warn(`Login falhou: senha incorreta (${userName})`);
    throw new Error('Credenciais inválidas');
  }

  if (!user.groupId) {
    logger.error(`Login falhou: usuário sem grupo definido (${userName})`);
    throw new Error('Configuração de usuário inválida');
  }

  const userGroup = await Group.findById(user.groupId).select('name').lean();
  const isAdminUser = userGroup?.name === 'admin';

  // Buscar relações do usuário apenas se NÃO for admin
  let relations = { agentId: null, realEstateId: null, bankCorrespondentId: null };
  if (!isAdminUser) {
    relations = await identifyUserRelations(user._id.toString());
  }

  // JWT Claims (ofuscados)
  // sub = userId (padrão JWT - não alterado)
  // grp = groupId
  // usr = userName
  // aid = agentId
  // reid = realEstateId
  // bcid = bankCorrespondentId  

  const payload = {
    sub: user._id.toString(), // sub é padrão JWT (não deve ser alterado)
    group: user.groupId.toString(),
    userName: user.userName,
    // Nomes ofuscados para reduzir exposição de estrutura de dados
    ...(relations.agentId && { aid: relations.agentId }),
    ...(relations.realEstateId && { reid: relations.realEstateId }),
    ...(relations.bankCorrespondentId && { bcid: relations.bankCorrespondentId })
  };

  logger.info("[AUTH] Payload JWT gerado", { 
    userName, 
    userId: user._id.toString(),
    isAdmin: isAdminUser,
    hasAgent: !!relations.agentId,
    hasRealEstate: !!relations.realEstateId,
    hasBankCorrespondent: !!relations.bankCorrespondentId,
    payload
  });

  const secret = config.jwt.secret;
  if (!secret) {
    logger.error('JWT secret não configurada corretamente');
    throw new Error('Configuração de autenticação inválida');
  }

  const signOptions = { jwtid: crypto.randomUUID() };
  if (!isAdminUser) signOptions.expiresIn = config.jwt.expiresIn || '1h';

  return jwt.sign(payload, secret, signOptions);
}

export async function registerUser({ userName, password, groupId }) {
  const existing = await User.findOne({ userName, status: 'active' });
  if (existing) {
    if (userName === 'admin') {
      const obj = existing.toObject();
      delete obj.password;
      return obj;
    }
    throw new Error('Já existe usuário ativo com este userName');
  }
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  const user = new User({ userName, password: hash, groupId });
  await user.save();
  const obj = user.toObject(); delete obj.password;
  return obj;
}

export async function listUsers({ status, groupId }) {
  const query = {};
  if (status) query.status = status;
  if (groupId) query.groupId = groupId;
  return User.find(query).select('-password');
}

/**
 * Gera um token de impersonação (OBO) para um agente específico.
 * Permite que o admin gere um token temporário para um agente sem necessidade de senha.
 * 
 * @param {string} agentId - ID do agente para o qual gerar o token
 * @param {number} ttlSeconds - Tempo de vida do token em segundos (padrão: 300s = 5 min)
 * @returns {Promise<string>} Token JWT de impersonação
 * @throws {Error} Se agentId não for fornecido ou se não encontrar usuário vinculado ao agente
 */
export async function generateOboTokenForAgent({ agentId, ttlSeconds = 300 }) {
  if (!agentId) {
    logger.error('[AUTH] Tentativa de impersonação sem agentId');
    throw new Error('agentId é obrigatório para gerar token de impersonação');
  }

  // Buscar o agente no serviço externo
  if (!AGENT_URL) {
    logger.error('[AUTH] APP_AGENT_SERVICE_URL não configurado');
    throw new Error('Serviço de agentes não está configurado');
  }

  let agent;
  try {
    const url = `${AGENT_URL}/agents/${agentId}`;
    logger.debug?.('[AUTH] Buscando agente para impersonação', { url, agentId });
    const { data } = await http.get(url);
    agent = data;
    
    if (!agent || !isActive(agent)) {
      logger.warn('[AUTH] Agente não encontrado ou inativo', { agentId });
      throw new Error('Agente não encontrado ou está inativo');
    }
  } catch (error) {
    logger.error('[AUTH] Erro ao buscar agente para impersonação', { 
      agentId, 
      status: error?.response?.status,
      message: error?.message 
    });
    throw new Error(`Não foi possível buscar o agente: ${error?.message || 'erro desconhecido'}`);
  }

  // Identificar o userId do agente
  const userId = agent.ownerAuthId;
  if (!userId) {
    logger.error('[AUTH] Agente não possui userId vinculado', { agentId, agent });
    throw new Error('Agente não possui usuário vinculado');
  }

  // Buscar usuário no banco de dados
  const user = await User.findById(userId).lean();
  if (!user || user.status !== 'active') {
    logger.warn('[AUTH] Usuário do agente não encontrado ou inativo', { userId, agentId });
    throw new Error('Usuário do agente não encontrado ou está inativo');
  }

  // Buscar relações do usuário
  const relations = await identifyUserRelations(userId.toString());
  
  // Validar que o agentId corresponde
  if (relations.agentId !== agentId.toString()) {
    logger.warn('[AUTH] AgentId informado não corresponde ao agente vinculado ao usuário', { 
      requestedAgentId: agentId, 
      foundAgentId: relations.agentId,
      userId 
    });
    throw new Error('AgentId não corresponde ao usuário');
  }

  // Gerar payload do token OBO
  const payload = {
    sub: user._id.toString(),
    group: user.groupId.toString(),
    userName: user.userName,
    ...(relations.agentId && { aid: relations.agentId }),
    ...(relations.realEstateId && { reid: relations.realEstateId }),
    ...(relations.bankCorrespondentId && { bcid: relations.bankCorrespondentId }),
    impersonation: true, // Flag indicando que é um token de impersonação
    impersonatedBy: 'admin' // Pode ser melhorado para incluir o userId do admin que gerou
  };

  const secret = config.jwt.secret;
  if (!secret) {
    logger.error('[AUTH] JWT secret não configurada');
    throw new Error('Configuração de autenticação inválida');
  }

  // Token com TTL customizado
  const token = jwt.sign(payload, secret, { 
    jwtid: crypto.randomUUID(),
    expiresIn: `${ttlSeconds}s`
  });

  logger.info('[AUTH] Token OBO gerado com sucesso', { 
    agentId, 
    userId, 
    userName: user.userName,
    ttlSeconds 
  });

  return token;
}
