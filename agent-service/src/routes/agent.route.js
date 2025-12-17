// src/routes/agent.route.js
import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import { buildRecursiveScopeAgent } from '../middlewares/buildRecursiveScopeAgent.js';
import {
  createAgent,
  getAgents,
  getAgentById,
  getActiveByPhoneNumber,
  getActiveByWhatsappJid,
  updateAgent,
  deleteAgent,
  listAgentsByOwner
} from '../controllers/agent.controller.js';

const router = Router();
const APP_RESOURCE_NAME = process.env.APP_RESOURCE_NAME || 'agent-service';

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'agent-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Autentica e carrega escopo do correspondente/imobiliárias
router.use(authorizeAccessUser);

// Rota leve: sem escopo recursivo
router.get('/agents/by-phone/:phoneNumber', authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ), getActiveByPhoneNumber);
router.get('/agents/by-whatsapp/:whatsappJid', authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ), getActiveByWhatsappJid);

// Escopo só para o restante (precisa de owner/linked etc.)
router.use(buildRecursiveScopeAgent);

router.post('/agents', authorizeGroupResource(APP_RESOURCE_NAME, PERM.CREATE), createAgent);
router.get('/agents', authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ), getAgents);
router.get('/agents/:id', authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ), getAgentById);
router.put('/agents/:id', authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), updateAgent);
router.delete('/agents/:id', authorizeGroupResource(APP_RESOURCE_NAME, PERM.DELETE), deleteAgent);

router.get('/agents/by-owner/:ownerAuthId', authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ), listAgentsByOwner);

export default router;
