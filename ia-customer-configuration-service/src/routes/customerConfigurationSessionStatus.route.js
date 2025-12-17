// src/routes/customerConfigurationSessionStatus.route.js
import { Router } from 'express';
import { activateSession, deactivateSession } from '../controllers/customerConfigurationSession.controller.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = Router();

// somente admin
router.use(authorizeAccessAdmin);

/** Enfileira a ativação da sessão para um número de WhatsApp. */
router.post('/whatsapp/activate', activateSession);

/** Enfileira a desativação da sessão para um número de WhatsApp. */
router.post('/whatsapp/deactivate', deactivateSession);

export default router;
