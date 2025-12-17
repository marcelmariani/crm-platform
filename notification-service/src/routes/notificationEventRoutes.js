// D:\SmartIASystems\notification-service\src\routes\notificationEventRoutes.js
import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { eventQueue } from '../queues/eventQueue.js'; // ← nomeado
import logger from '../config/logger.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.use(authorizeAccessUser);

router.post('/notifications/events', async (req, res) => {
  try {
    const { type, source, payload = {}, recipients, channelHints } = req.body || {};
    if (!type || typeof type !== 'string') {
      return res.status(400).json({ message: 'type required' });
    }

    const eventName = type.startsWith('sales.') ? type : `sales.${type}`;
    const jobPayload = {
      event: eventName,
      source: source || 'notification-service.api',
      payload,
      recipients,
      channelHints,
      auth: { sub: req.user?.sub, group: req.user?.group },
      ts: Date.now(),
    };

    await eventQueue.add(eventName, jobPayload);
    return res.status(202).json({ queued: true, event: eventName });
  } catch (err) {
    logger.error('notification_events_enqueue_failed', { err: err?.message });
    return res.status(502).json({ message: 'queue unavailable' });
  }
});

export default router;
