// src/controllers/health.controller.js
import mongoose from 'mongoose';
import IORedis from 'ioredis';

export async function healthCheck(req, res) {
  // MongoDB status
  const mongoState = mongoose.connection.readyState;
  let mongoStatus = 'unknown';
  switch (mongoState) {
    case 0: mongoStatus = 'disconnected'; break;
    case 1: mongoStatus = 'connected'; break;
    case 2: mongoStatus = 'connecting'; break;
    case 3: mongoStatus = 'disconnecting'; break;
  }

  // Redis status (tentativa simples)
  let redisStatus = 'unknown';
  try {
    const redis = new IORedis(process.env.REDIS_URL);
    await redis.ping();
    redisStatus = 'connected';
    redis.disconnect();
  } catch {
    redisStatus = 'disconnected';
  }

  res.json({
    status: 'ok',
    mongo: mongoStatus,
    redis: redisStatus,
    timestamp: new Date().toISOString(),
  });
}
