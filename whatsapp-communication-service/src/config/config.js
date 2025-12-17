// src/config/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const env = process.env.NODE_ENV || 'development';

// carrega .env.<env> na raiz do projeto, suprimindo logs informativos
dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${env}`), silent: true });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

export default {
  env,
  port: Number(process.env.PORT) || 3016,
  mongoUri,
  mongoDB: process.env.MONGO_DATABASE,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },
  redis: {
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST || undefined,
    port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : undefined,
    username: process.env.REDIS_USER || undefined,
    password: process.env.REDIS_PASS || undefined,
    prefix: process.env.REDIS_PREFIX || '',
  },  
  sslKeyPath: process.env.SSL_KEY_PATH,
  sslCertPath: process.env.SSL_CERT_PATH,
  authServiceUrl: process.env.JWT_SERVICE_URL,
  skipTlsVerify: process.env.SKIP_TLS_VERIFY === 'true',
  services: {
    authBaseUrl: process.env.JWT_SERVICE_URL,
    authLoginPath: process.env.JWT_LOGIN_PATH || '/login',
  },
};
