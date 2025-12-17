// src/index.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import config from './config/config.js';
import logger from './config/logger.js';
import './config/database.js';
import realEstateRoutes from './routes/realEstate.route.js';

/**
 * Resolve um caminho de certificado: se for relativo, assume que está em
 * process.cwd() (raiz do prj); se for absoluto, usa direto.
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
  app.use('/v1', realEstateRoutes);
  return app;
}

// Inicialização real (não executa em test)
const env = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3001;

if (!['test'].includes(env)) {
  const app = createServer();

  // Em produção, assume TLS terminado externamente — sobe HTTP simples.
  if (env === 'production') {
    app.listen(PORT, () => {
      logger.info(`HTTP server rodando em ${PORT} [${env}] (TLS terminado externamente)`);
    });
  } else {
    // development / staging: espera certificados e usa HTTPS
    const keyPath = resolveCertPath(config.sslKeyPath);
    const certPath = resolveCertPath(config.sslCertPath);

    if (!keyPath || !certPath) {
      logger.error('Caminho de certificado não definido corretamente (sslKeyPath / sslCertPath).');
      process.exit(1);
    }

    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
      logger.error(`Certificados não encontrados em ${keyPath} ou ${certPath}`);
      process.exit(1);
    }

    const sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };

    https.createServer(sslOptions, app).listen(PORT, () => {
      logger.info(`🔒 HTTPS em ${PORT} [${env}] usando certificados locais`);
    });
  }
}

// Export default para compatibilidade (quem importa sem destruturação ainda obtém o app)
export default createServer();
