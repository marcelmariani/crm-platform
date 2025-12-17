// src/config/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const env = process.env.NODE_ENV || 'development';

dotenv.config({
  path: path.resolve(__dirname, '../../', `.env.${env}`),
  override: false,
});

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || '';

export default {
  env,
  port: Number(process.env.PORT) || 3003,

  // Mongo
  mongoUri,
  mongoDB: process.env.MONGO_DATABASE || undefined,

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
    authBaseUrl: process.env.JWT_SERVICE_URL || '',
    authLoginPath: process.env.JWT_LOGIN_PATH || '/v1/auth/login',
    authGrantsCheckPath: process.env.AUTH_GRANTS_CHECK_PATH || '/grants/effective',
    authGrantsCheckMethod: (process.env.AUTH_GRANTS_CHECK_METHOD || 'GET').toUpperCase(),
    authGrantsQueryGroupKey: process.env.AUTH_GRANTS_QUERY_GROUP_KEY || 'groupId',
    authGrantsQueryResourceKey: process.env.AUTH_GRANTS_QUERY_RESOURCE_KEY || 'resourceName',
    bankCorrespondentBaseUrl: process.env.APP_BANK_CORRESPONDENT_SERVICE_URL,
    realEstateBaseUrl: process.env.APP_REAL_ESTATE_SERVICE_URL || '',
  },

  // Outros
  skipTlsVerify: process.env.SKIP_TLS_VERIFY === 'true',
  appResourceName: process.env.APP_RESOURCE_NAME || 'real-estate-service',
};
