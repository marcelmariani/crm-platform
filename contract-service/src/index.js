// src/index.js (sem mudanças funcionais; apenas garante bootstrap dos novos status)
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import helmet from 'helmet';
import config from './config/config.js';
import logger from './config/logger.js';
import './config/database.js';

import contractRoutes from './routes/contractRoutes.js';
import contractStatusRoutes from './routes/contractStatusRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { bootstrapcontractStatuses } from './bootstrap/contractStatus.bootstrap.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveCertPath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

export function createServer() {
  const app = express();

  app.use(helmet());
  app.disable('x-powered-by');

  app.use(cors());
  app.use(express.json());

  app.use('/v1', healthRoutes);
  app.use('/v1', contractRoutes);
  app.use('/v1', contractStatusRoutes);

  app.use(errorHandler);

  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3006;

async function start() {
  if (env === 'test') return;

  try {
    await bootstrapcontractStatuses();
    logger.info('Bootstrap de Status de Contratos executado com sucesso');
  } catch (e) {
    logger.error('Bootstrap de Status de Contratos falhou', { msg: e?.message, code: e?.code, stack: e?.stack });
  }

  const app = createServer();

  if (env === 'production') {
    app.listen(PORT, () => {
      logger.info(`HTTP ${pkg.name} em ${PORT} [${env}] (TLS externo)`);
    });
    return;
  }

  const keyPath = resolveCertPath(process.env.SSL_KEY_PATH || config.sslKeyPath);
  const certPath = resolveCertPath(process.env.SSL_CERT_PATH || config.sslCertPath);

  if (!keyPath || !certPath) {
    logger.error('Defina SSL_KEY_PATH e SSL_CERT_PATH ou config.*');
    process.exit(1);
  }
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    logger.error(`Certs ausentes em "${keyPath}" ou "${certPath}"`);
    process.exit(1);
  }

  const sslOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

  https.createServer(sslOptions, app).listen(PORT, () => {
    logger.info(`HTTPS ${pkg.name} em ${PORT} [${env}]`);
  });
}

await start();

export default createServer();
