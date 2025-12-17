/* === D:\SmartIASystems\product-service\src\index.js === */
// src/index.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import config from './config/config.js';
import logger from './config/logger.js';
import './config/database.js';
import productRouter from './routes/productRoutes.js';
import { notFound, errorHandler } from './middlewares/errorHandler.js';

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

  app.set('trust proxy', true);
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // health
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: pkg.name, env: config.env }));
  app.get('/v1/health', (_req, res) => res.json({ status: 'ok', service: pkg.name, env: config.env }));

  app.use('/v1', productRouter);

  // 404 + error handler
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3002;

if (env !== 'test') {
  const app = createServer();

  // Produção: TLS externo, apenas HTTP interno
  if (env === 'production') {
    http.createServer(app).listen(PORT, () => {
      logger.info(`HTTP para ${pkg.name} em ${PORT} [${env}] (TLS externo)`);
    });
  } else {
    const keyPath = resolveCertPath(process.env.SSL_KEY_PATH || config.sslKeyPath);
    const certPath = resolveCertPath(process.env.SSL_CERT_PATH || config.sslCertPath);
    const requireTls = config.requireTls === true;

    const hasKey = keyPath && fs.existsSync(keyPath);
    const hasCert = certPath && fs.existsSync(certPath);

    if (hasKey && hasCert) {
      const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      https.createServer(sslOptions, app).listen(PORT, () => {
        logger.info(`🔒 HTTPS para ${pkg.name} em ${PORT} [${env}] usando certificados locais`);
      });
    } else if (requireTls) {
      logger.error(`Certificados SSL não encontrados em "${keyPath}" ou "${certPath}" e REQUIRE_TLS=true.`);
      process.exit(1);
    } else {
      logger.warn(
        `Certificados ausentes (${keyPath} | ${certPath}). Iniciando HTTP por fallback em ${PORT} [${env}].`
      );
      http.createServer(app).listen(PORT, () => {
        logger.info(`HTTP (fallback) para ${pkg.name} em ${PORT} [${env}]`);
      });
    }
  }
}

export default createServer();
