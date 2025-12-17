// src/routes/healthRoutes.js
import { Router } from 'express';
import { healthMongo } from '../config/database.js';
import eventQueue from '../queues/eventQueue.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'contract-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.get('/ready', async (_req, res) => {
  const mongo = await healthMongo();
  let redis = false;
  try { redis = (await eventQueue.ping()) === 'PONG'; } catch {}  
  if (!mongo || !redis) return res.status(503).json({ status: 'degraded', mongo: !!mongo, redis });
  return res.json({ status: 'ready', mongo: true, redis: true });
});

export default router;
