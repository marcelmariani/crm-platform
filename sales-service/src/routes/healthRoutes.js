// src/routes/healthRoutes.js
import { Router } from 'express';
import { healthMongo } from '../config/database.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    service: process.env.APP_RESOURCE_NAME || 'sales-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.get('/ready', async (_req, res) => {
  const mongo = await healthMongo();
  
  // Redis é opcional - não falha se não estiver disponível
  let redis = false;
  try {
    const { getRedisConnection } = await import('../queues/salesEventsQueue.js');
    const conn = getRedisConnection();
    if (conn) {
      const result = await conn.ping();
      redis = result === 'PONG';
    }
  } catch (err) {
    // Redis não disponível ou não configurado
    redis = false;
  }
  
  if (!mongo) {
    return res.status(503).json({ status: 'degraded', mongo: false, redis });
  }
  
  return res.json({ status: 'ready', mongo: true, redis });
});

export default router;
