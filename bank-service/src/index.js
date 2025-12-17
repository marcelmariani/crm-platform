// src/index.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import config from './config/bank.config.js';
import logger from './config/bank.logger.js';
import './config/bank.database.js'; 
import bankRouter from './routes/bank.route.js';


const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve um caminho de certificado: se for relativo, assume que está em
 * process.cwd() (raiz do projeto); se for absoluto, usa direto.
 * @param {string|undefined} p
 * @returns {string|null}
 */
function resolveCertPath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

/**
 * Cria e configura o Express app sem ligá-lo em uma porta.
 * Usado por testes e também pela inicialização real.
 * @returns {import('express').Express}
 */
export function createServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/v1', bankRouter);
  return app;
}

const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3002;

if (!['test'].includes(env)) {
  const app = createServer();

  // Em produção, assume TLS terminado externamente; sobe HTTP simples.
  if (env === 'production') {
    app.listen(PORT, () => {
      logger.info(`HTTP server para ${pkg.name} rodando em ${PORT} [${env}] (TLS terminado externamente)`);
    });
  } else {
    // development / staging: espera certificados e usa HTTPS local
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

    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };

    https.createServer(sslOptions, app).listen(PORT, () => {
      logger.info(`🔒 HTTPS para ${pkg.name} em ${PORT} [${env}] usando certificados locais`);
    });
  }
}

// Export default para compatibilidade (quem importa sem destruturação ainda obtém o app)
export default createServer();
