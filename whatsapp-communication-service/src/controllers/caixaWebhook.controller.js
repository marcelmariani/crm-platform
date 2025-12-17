import { handleCaixaCallback } from '../services/caixaSimulator.service.js';
import logger from '../config/logger.js';
import mongoose from 'mongoose';

export async function handleCaixaWebhook(req, res, next) {
  try {
    return await handleCaixaCallback(req, res, next);
  } catch (err) {
    logger.error({ err: String(err?.stack || err) }, 'webhook.unhandled');
    return next(err);
  }
}

export async function webhookHealth(_req, res) {
  const mongoState = mongoose?.connection?.readyState;
  const isMongoUp = mongoState === 1;
  const details = {
    ok: true,
    service: process.env.APP_RESOURCE_NAME || 'whatsapp-communication-service',
    webhook: {
      path: '/v1/caixa/webhook',
      method: 'POST',
      expects: ['whatsappSimulationId:ObjectId', 'status', 'result?']
    },
    environment: process.env.NODE_ENV || 'development',
    mongo: { connected: isMongoUp, state: mongoState },
    time: new Date().toISOString()
  };
  return res.status(200).json(details);
}
