// src/index.js
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

import healthRoutes from './routes/healthRoutes.js';
import proposalRoutes from './routes/proposalRoutes.js';
import proposalStatusRoutes from './routes/proposalStatusRoutes.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { bootstrapProposalStatuses } from './bootstrap/proposalStatus.bootstrap.js';

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

  // Health routes - sem autenticação
  app.use('/v1', healthRoutes);

  // Rotas já definem /v1 internamente. Não prefixar aqui para evitar /v1/v1.
  app.use('/v1', proposalRoutes);
  app.use('/v1', proposalStatusRoutes);

  // Handler de erros sempre por último
  app.use(errorHandler);

  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3006;

async function start() {
  if (env === 'test') return;

  // Bootstrap idempotente após DB conectado
  try {
    await bootstrapProposalStatuses();
    logger.info('Bootstrap de inicialização de Status de Propostas executado com sucesso');
  } catch (e) {
    logger.error('Bootstrap de inicialização de Status de Propostas executado com falha', { msg: e?.message, code: e?.code, stack: e?.stack });

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

// Compatibilidade com import default em testes
export default createServer();
