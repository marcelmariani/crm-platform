import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import helmet from 'helmet';
import { v4 as uuid } from 'uuid';
import config from './config/config.js';
import logger from './config/logger.js';
import './config/database.js';
import notificationEventRoutes from './routes/notificationEventRoutes.js';

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
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { req.requestId = req.headers['x-request-id'] || uuid(); next(); });

  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.get('/readyz', (_req, res) => res.json({ status: 'ready' }));

  app.use('/v1', notificationEventRoutes);
  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3006;

if (!['test'].includes(env)) {
  const app = createServer();
  let server;

  if (env === 'production') {
    server = app.listen(PORT, () => {
      logger.info(`HTTP server para ${pkg.name} rodando em ${PORT} [${env}] (TLS terminado externamente)`);
    });
  } else {
    const keyPath = resolveCertPath(process.env.SSL_KEY_PATH || config.sslKeyPath);
    const certPath = resolveCertPath(process.env.SSL_CERT_PATH || config.sslCertPath);

    if (!keyPath || !certPath) {
      logger.error('Caminho de certificado não definido corretamente (SSL_KEY_PATH / SSL_CERT_PATH ou config).');
      process.exit(1);
    }

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      logger.error(`Certificados SSL não encontrados em "${keyPath}" ou "${certPath}".`);
      process.exit(1);
    }

    const sslOptions = { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };

    server = https.createServer(sslOptions, app).listen(PORT, () => {
      logger.info(`🔒 HTTPS para ${pkg.name} em ${PORT} [${env}] usando certificados locais`);
    });
  }

  const shutdown = async () => {
    try {
      logger.info('Shutting down...');
      await new Promise(resolve => server.close(resolve));
      const { closeDatabase } = await import('./config/database.js');
      await closeDatabase();
      process.exit(0);
    } catch (e) {
      logger.error('Error on shutdown', { error: e?.message });
      process.exit(1);
    }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export default createServer();
