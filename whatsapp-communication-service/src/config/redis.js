import IORedis from 'ioredis';

function buildRedisOptions() {
  const url = process.env.REDIS_URL;          // ex: redis://:pass@localhost:6379/0  ou rediss://...
  if (url) return url;
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASS || process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB || 0),
  };
}

export const redis = new IORedis(buildRedisOptions());
redis.on('error', (e) => console.error('redis.error', e.message));
