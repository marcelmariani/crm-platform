import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

import config from './config/auth.config.js';
import logger from './config/auth.logger.js';
import './config/auth.database.js';

import {authorizeAccessUser} from './middlewares/authorizeAccessUser.js';
import authRoutes from './routes/auth.route.js';
import groupRoutes from './routes/group.route.js';
import resourceRoutes from './routes/resource.route.js';
import grantRoutes from './routes/grant.route.js';
import healthRoutes from './routes/health.route.js';
import { runBootstrapOnStart } from './utils/bootstrapOnStart.js';

const require = createRequire(import.meta.url);
const pkg     = require('../package.json');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Resolve o caminho de um certificado SSL.
 * Se fornecido como relativo, assume-se a partir de process.cwd().
 * @param {string|undefined} p - Caminho absoluto ou relativo
 * @returns {string|null} Caminho absoluto ao certificado, ou null
 */
function resolveCertPath(p) {
  if (!p) return null;
  return path.isAbsolute(p)
    ? p
    : path.resolve(process.cwd(), p);
}

/**
 * Cria e configura instância do Express sem iniciar o servidor.
 * Permite uso em testes ou bootstrap em outro ponto.
 * @returns {import('express').Express} Aplicação Express configurada
 */
export function createServer() {
  const app = express();

  // Middlewares globais
  app.use(cors());
  app.use(express.json());

  // Rotas públicas
  app.use('/v1/health',    healthRoutes);
  app.use('/v1/auth',      authRoutes);
  app.use('/v1/groups',    groupRoutes);
  app.use('/v1/resources', resourceRoutes);
  app.use('/v1/grants',    grantRoutes);

  // Exemplo de rota protegida extra
  app.use(
    '/v1/protected',
    authorizeAccessUser,
    (req, res) => {
      res.json({ message: 'Rota protegida', user: req.user });
    }
  );

  return app;
}

// ENV e porta padrão
const env  = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || config.port) || 3000;

// Inicialização real (não executa em ambiente de teste)
if (env !== 'test') {
  const app = createServer();

  (async () => {

    // Executa bootstrap do Auth se necessário (idempotente)
    await runBootstrapOnStart();

    // --- Inicia servidor HTTP/HTTPS ---
    if (env === 'production') {
      app.listen(PORT, () => {
        logger.info(
          `HTTP server para ${pkg.name} rodando em ${PORT} [${env}] (TLS externo)`
        );
      });
    } else {
      const keyPath  = resolveCertPath(
        process.env.SSL_KEY_PATH || config.sslKeyPath
      );
      const certPath = resolveCertPath(
        process.env.SSL_CERT_PATH || config.sslCertPath
      );

      if (!keyPath || !certPath) {
        logger.error(
          'SSL_KEY_PATH/SSL_CERT_PATH ou config.ssl* não definidos'
        );
        process.exit(1);
      }
      if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        logger.error(
          `Certificados não encontrados: "${keyPath}" ou "${certPath}"`
        );
        process.exit(1);
      }

      const sslOptions = {
        key:  fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };

      https
        .createServer(sslOptions, app)
        .listen(PORT, () => {
          logger.info(
            `🔒 HTTPS para ${pkg.name} em ${PORT} [${env}] com certificados locais`
          );
        });
    }
  })();
}

// Exporta server para compatibilidade de import não-desestruturado
export default createServer();