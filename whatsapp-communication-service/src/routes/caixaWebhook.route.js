import express from 'express';
import { handleCaixaWebhook, webhookHealth } from '../controllers/caixaWebhook.controller.js';

const router = express.Router();
router.post('/', handleCaixaWebhook);
router.get('/health', webhookHealth);
export default router;
