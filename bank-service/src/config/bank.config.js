// src/config/config.js

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const env        = process.env.NODE_ENV || 'development';

// Carrega .env.development, .env.test, etc.
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env.${env}`)
});

const config = {
  env,
  port:     Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  mongoDB:  process.env.MONGO_DATABASE,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },
  services: {
    bankBaseUrl: process.env.BANK_SERVICE_URL,          // << obrigatório
    authBaseUrl: process.env.JWT_AUTH_SERVICE_URL,
  },
  skipTlsVerify: String(process.env.SKIP_TLS_VERIFY).toLowerCase() === 'true',
  sslKeyPath: process.env.SSL_KEY_PATH,
  sslCertPath: process.env.SSL_CERT_PATH,
};

export default config;
