// src/controllers/authController.js
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import logger from '../config/auth.logger.js';
import config from '../config/auth.config.js';
import Group from '../models/group.model.js';
import User from '../models/user.model.js';
import {
  registerUser,
  authenticateUser,
  listUsers,
  generateOboTokenForAgent
} from '../services/auth.service.js';

/**
 * Utilitário: lê JWT do body ou do header Authorization.
 */
function readToken(req) {
  const bodyToken = req.body?.token && String(req.body.token).trim();
  const h = req.headers.authorization || req.headers.Authorization || '';
  const headerToken = h.startsWith('Bearer ') ? h.slice(7).trim() : (h || '').trim();
  return bodyToken || headerToken || '';
}

/**
 * Resolve o nome do grupo por ID.
 */
async function getGroupNameById(groupId) {
  try {
    if (!groupId) return null;
    const g = await Group.findById(groupId).select('name').lean();
    return g?.name || null;
  } catch {
    return null;
  }
}

/**
 * POST /v1/auth/introspect
 * Retorna 200 sempre. active=false para token inválido/expirado.
 * Aceita { "token": "<JWT>" } no body ou Authorization: Bearer <JWT>.
 */
export async function introspect(req, res) {
  try {
    const token = readToken(req);
    if (!token) return res.status(200).json({ active: false, error: 'token_missing' });

    const secret = config.jwt.secret;
    if (!secret) return res.status(500).json({ message: 'JWT secret not configured' });

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      return res.status(200).json({ active: false, error: e?.name || 'invalid_token' });
    }

    const sub      = payload.sub || payload.userId || null;
    const group    = payload.group || null;
    const userName = payload.userName || payload.username || null;
    const roles    = Array.isArray(payload.roles) ? payload.roles : [];
    const scopes   = Array.isArray(payload.scopes)
      ? payload.scopes
      : (typeof payload.scope === 'string' ? payload.scope.split(' ') : []);

    const groupName = await getGroupNameById(group);

    // Monta resposta estilo RFC 7662
    const resp = {
      active: true,
      token_type: 'access_token',
      sub,
      userId: sub,
      userName,
      group,
      groupName,
      roles,
      scopes,
      iat: payload.iat,
      exp: payload.exp,
      nbf: payload.nbf,
      jti: payload.jti,
    };

    return res.status(200).json(resp);
  } catch (err) {
    logger.error('Erro em introspect', { err: err?.message });
    return res.status(500).json({ message: 'Introspection error', detail: err?.message });
  }
}

/**
 * Controller para registro de usuário.
 */
export async function registerUserController(req, res) {
  const { userName, password, groupId } = req.body;

  if (!userName || typeof userName !== 'string') {
    return res.status(400).json({ error: 'Campo "userName" é obrigatório e deve ser uma string.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Campo "password" é obrigatório e deve ter ao menos 6 caracteres.' });
  }
  if (!groupId || typeof groupId !== 'string') {
    return res.status(400).json({ error: 'Campo "groupId" é obrigatório e deve ser o ID de um grupo.' });
  }

  let targetGroup;
  try {
    targetGroup = await Group.findById(groupId);
  } catch (err) {
    logger.error('Erro ao buscar grupo no register:', err);
    return res.status(500).json({ error: 'Erro interno ao verificar grupo.' });
  }
  if (!targetGroup) {
    return res.status(404).json({ error: 'Grupo não encontrado.' });
  }

  try {
    const user = await registerUser({ userName, password, groupId });
    return res.status(201).json(user);
  } catch (err) {
    logger.error('Erro no register:', err);
    return res.status(400).json({ error: err.message });
  }
}

/**
 * Controller para login de usuário.
 */
export async function loginController(req, res) {
  const { userName, password } = req.body;
  if (!userName || !password) {
    return res.status(400).json({ error: 'userName e password são obrigatórios.' });
  }
  try {
    const token = await authenticateUser(userName, password);
    return res.json({ token });
  } catch (err) {
    logger.error('Erro no login:', err);
    return res.status(401).json({ error: err.message });
  }
}

/**
 * Controller para listar usuários (filtros opcionais).
 */
export async function listUsersController(req, res) {
  const { status, groupId } = req.query;
  try {
    const users = await listUsers({ status, groupId });
    return res.json(users);
  } catch (err) {
    logger.error('Erro ao listar usuários:', err);
    return res.status(500).json({ error: 'Erro ao buscar usuários' });
  }
}

/**
 * Controller para buscar usuário por ID.
 */
export async function getUserByIdController(req, res) {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'ID inválido' });
  }
  try {
    const user = await User.findById(id).select('-password').lean();
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    return res.json(user);
  } catch (err) {
    logger.error('Erro ao buscar usuário por ID:', err);
    return res.status(500).json({ error: 'Erro ao buscar usuário' });
  }
}

/**
 * Controller para gerar token de impersonação (OBO) para um agente.
 * POST /auth/impersonate
 * Body: { agentId: string, ttlSeconds?: number }
 * Requer autenticação de admin.
 */
export async function impersonateAgentController(req, res) {
  const { agentId, ttlSeconds } = req.body;
  
  if (!agentId || typeof agentId !== 'string') {
    return res.status(400).json({ 
      error: 'Campo "agentId" é obrigatório e deve ser uma string.' 
    });
  }

  // Validar ttlSeconds se fornecido
  if (ttlSeconds !== undefined) {
    const ttl = Number(ttlSeconds);
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > 86400) { // máx 24h
      return res.status(400).json({ 
        error: 'Campo "ttlSeconds" deve ser um inteiro entre 1 e 86400 (24 horas).' 
      });
    }
  }

  try {
    const token = await generateOboTokenForAgent({ 
      agentId, 
      ttlSeconds: ttlSeconds || 300 
    });
    
    logger.info('[AUTH] Token de impersonação gerado', { 
      agentId, 
      ttlSeconds: ttlSeconds || 300,
      requestedBy: req.user?.userName || 'unknown'
    });

    return res.status(200).json({ 
      token
    });
  } catch (err) {
    logger.error('[AUTH] Erro ao gerar token de impersonação:', { 
      error: err?.message,
      agentId 
    });
    return res.status(400).json({ 
      error: err?.message || 'Erro ao gerar token de impersonação' 
    });
  }
}