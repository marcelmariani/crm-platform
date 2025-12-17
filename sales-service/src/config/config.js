// src/config/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Descobre o ambiente pela cross-env
const env = process.env.NODE_ENV || 'development';

// 2) Carrega arquivos .env sem sobrescrever variáveis já definidas pelo ambiente
//    Importante para ambientes gerenciados (ex.: Render) onde as vars já vêm corretas.
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env`),
  override: false,
});
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env.${env}`),
  override: false,
});

// 3) Agora lê as variáveis
// Aceita também MONGODB_URI como fallback comum em provedores
const mongoUri =
  (process.env.MONGO_URI && process.env.MONGO_URI.trim()) ||
  (process.env.MONGODB_URI && process.env.MONGODB_URI.trim()) ||
  '';
const mongoDB = process.env.MONGO_DATABASE || undefined;

export default {
  env,
  port: Number(process.env.PORT) || 3007,

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
      process.env.SERVICES_AUTH_GRANTS_CHECK_PATH || 'grants/effective',
    authGrantsCheckMethod:
      (process.env.SERVICES_AUTH_GRANTS_CHECK_METHOD || 'GET').toUpperCase(),
    authGrantsQueryGroupKey:
      process.env.SERVICES_AUTH_GRANTS_QUERY_GROUP_KEY || 'groupId',
    authGrantsQueryResourceKey:
      process.env.SERVICES_AUTH_GRANTS_QUERY_RESOURCE_KEY || 'resourceName',

    bankCorrespondentBaseUrl:
      process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || '',
    realEstateBaseUrl: process.env.APP_REAL_ESTATE_SERVICE_URL || '',
    contractBaseUrl: process.env.APP_CONTRACT_SERVICE_URL || '',
  },

  // Compat para middlewares antigos que esperam authServiceUrl
  authServiceUrl:
    process.env.AUTH_SERVICE_URL || process.env.JWT_SERVICE_URL || '',

  // Outros
  skipTlsVerify: process.env.SKIP_TLS_VERIFY === 'true',
  appResourceName: process.env.APP_RESOURCE_NAME || 'sales-service',

  // Opcional: configs lidas por eventQueue (também aceitam env vars)
  queue: {
    enabled: process.env.REDIS_QUEUE_ENABLED,
    attempts: process.env.REDIS_QUEUE_ATTEMPTS,
    backoffMs: process.env.REDIS_QUEUE_BACKOFF_MS,
    name: process.env.REDIS_QUEUE_NAME_SALES,
    dlq: process.env.REDIS_QUEUE_DLQ_PROPOSAL,
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
