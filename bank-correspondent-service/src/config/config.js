// src/config/config.js

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const env = process.env.NODE_ENV || 'development';

// Carrega .env.<env> na raiz do projeto
dotenv.config({ path: path.resolve(__dirname, '../../', `.env.${env}`) });

export default {
  env,
  port: Number(process.env.PORT) || 3002,
  mongoUri: process.env.MONGO_URI,
  mongoDB: process.env.MONGO_DATABASE,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',    // adicionado expiração
  },
  sslKeyPath: process.env.SSL_KEY_PATH,
  sslCertPath: process.env.SSL_CERT_PATH,
  authServiceUrl: process.env.JWT_SERVICE_URL,
  skipTlsVerify: process.env.SKIP_TLS_VERIFY === 'true',
  services: {
    authBaseUrl: process.env.JWT_SERVICE_URL,
    authLoginPath: process.env.JWT_LOGIN_PATH || '/login'
  },
};
