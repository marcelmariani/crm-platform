// src/config/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Descobre o ambiente pela cross-env
const env = process.env.NODE_ENV || 'development';

// 2) Carrega .env.<env> ANTES de ler process.env
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env.${env}`),
  override: true,
});
// (opcional) carrega .env base sem sobrescrever as já definidas
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env`),
  override: false,
});

// 3) Agora lê as variáveis
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';
const mongoDB = process.env.MONGO_DATABASE || undefined;

export default {
  env,
  port: Number(process.env.PORT) || 3011,

  // Mongo
  mongoUri,
  mongoDB,

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },

  // HTTPS
  sslKeyPath: process.env.SSL_KEY_PATH || undefined,
  sslCertPath: process.env.SSL_CERT_PATH || undefined,

  // Serviços
  services: {
    authBaseUrl:
      process.env.AUTH_SERVICE_URL ||
      process.env.JWT_SERVICE_URL ||
      '',
    authGrantsCheckPath:
      process.env.SERVICES_AUTH_GRANTS_CHECK_PATH || '/v1/grants/effective',
    authGrantsCheckMethod:
      (process.env.SERVICES_AUTH_GRANTS_CHECK_METHOD || 'GET').toUpperCase(),
    authGrantsQueryGroupKey:
      process.env.SERVICES_AUTH_GRANTS_QUERY_GROUP_KEY || 'groupId',
    authGrantsQueryResourceKey:
      process.env.SERVICES_AUTH_GRANTS_QUERY_RESOURCE_KEY || 'resourceName',

    bankCorrespondentBaseUrl:
      process.env.BANK_CORRESPONDENT_SERVICE_URL || '',
    realEstateBaseUrl: process.env.REAL_ESTATE_SERVICE_URL || '',

    // Notification-service
    notificationBaseUrl: process.env.NOTIFICATION_SERVICE_URL || '',
    notificationEventPath:
      process.env.SERVICES_NOTIFICATION_EVENT_PATH || '/v1/notifications/events',
    notificationCreatePath:
      process.env.SERVICES_NOTIFICATION_CREATE_PATH || '/v1/notifications',
    notificationPreferEvent:
      process.env.SERVICES_NOTIFICATION_PREFER_EVENT || 'true',
  },

  // Compat para middlewares antigos que esperam authServiceUrl
  authServiceUrl:
    process.env.AUTH_SERVICE_URL || process.env.JWT_SERVICE_URL || '',

  // Outros
  skipTlsVerify: process.env.SKIP_TLS_VERIFY === 'true',
  appResourceName: process.env.APP_RESOURCE_NAME || 'contract-service',

  // Opcional: configs lidas por eventQueue (também aceitam env vars)
  queue: {
    enabled: process.env.QUEUE_ENABLED,
    attempts: process.env.QUEUE_ATTEMPTS,
    backoffMs: process.env.QUEUE_BACKOFF_MS,
    name: process.env.QUEUE_NAME,
    dlq: process.env.QUEUE_DLQ,
  },
  redis: {
    url: process.env.REDIS_URL,
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    prefix: process.env.REDIS_PREFIX_SALES,
    tls: process.env.REDIS_TLS,
  },
};
