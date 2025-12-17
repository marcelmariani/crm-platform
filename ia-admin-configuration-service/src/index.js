// src/index.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import config from './config/adminConfiguration.config.js';
import logger from './config/adminConfiguration.logger.js';
import './config/adminConfiguration.database.js';
import { authorizeAccessUser as authMiddleware } from './middlewares/authorizeAccessUser.js';
import adminConfigurationRoute from './routes/adminConfiguration.route.js';
import { errorHandler } from './middlewares/adminConfiguration.errorHandler.js';

function resolveCertPath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/screenshots', express.static(path.resolve(process.cwd(), 'screenshots')));
  app.use('/v1', adminConfigurationRoute);
  app.use(errorHandler);

  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3013;

if (env !== 'test') {
  const app = createServer();

  if (env === 'production') {
    app.listen(PORT, () => logger.info(`HTTP em ${PORT} [${env}] (TLS externo)`));
  } else {
    const keyPath = resolveCertPath(process.env.SSL_KEY_PATH);
    const certPath = resolveCertPath(process.env.SSL_CERT_PATH);

    if (!keyPath || !certPath) {
      logger.error('Defina SSL_KEY_PATH e SSL_CERT_PATH');
      process.exit(1);
    }
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      logger.error(`Certificados não encontrados em ${keyPath} ou ${certPath}`);
      process.exit(1);
    }

    const sslOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
    https.createServer(sslOptions, app).listen(PORT, () => logger.info(`HTTPS em ${PORT} [${env}]`));
  }
}

export default createServer;
