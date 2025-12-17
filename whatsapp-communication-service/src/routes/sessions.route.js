import { Router } from 'express';
import {
  createSession,
  deleteSession,
  deleteAllSessions,
  getStatus,
  getQr
} from '../controllers/sessions.controller.js';
import { healthCheck } from '../controllers/health.controller.js';

const router = Router();

// Health check (sem autenticação)
router.get('/v1/health', healthCheck);

router.post('/whatsapp/session', createSession);
router.delete('/whatsapp/session', deleteAllSessions);

router.get('/whatsapp/session/:whatsappPhoneNumber/status', getStatus);
router.get('/whatsapp/session/:whatsappPhoneNumber/qr', getQr);
router.delete('/whatsapp/session/:whatsappPhoneNumber', deleteSession);

export default router;
