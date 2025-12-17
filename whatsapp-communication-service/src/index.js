/* === src/index.js === */
//import dotenvFlow from 'dotenv-flow';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import https from 'https';
import path from 'path';
import logger from './config/logger.js';
import config from './config/config.js';
import sessionsRouter from './routes/sessions.route.js';
import caixaWebhookRouter from './routes/caixaWebhook.route.js';
import { loadExistingSessions } from './services/session.service.js';
import { connectDatabase } from './config/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRouter from './routes/health.route.js';

const ENV  = process.env.NODE_ENV || 'development';
const PORT = Number(process.env.PORT || 3000);

function resolveCertPath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

async function bootstrap() {
  await connectDatabase();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/v1/ping', (_req, res) => res.json({ ok: true }));
  app.use('/v1', sessionsRouter);
  // o router deve exportar POST '/' para corresponder a /v1/caixa/webhook
  app.use('/v1/caixa/webhook', caixaWebhookRouter);
  app.use('/v1', healthRouter);
  app.use(errorHandler);

  if (ENV === 'production') {
    // Produção: HTTP interno, TLS no proxy externo
    app.listen(PORT, () => {
      logger.info('HTTP pronto (TLS externo)', { PORT, scheme: 'http', env: ENV });
      loadExistingSessions().catch(err =>
        logger.warn({ err: String(err?.message || err) }, 'Falha ao restaurar sessões')
      );
    });
    return;
  }

  // Desenvolvimento: TLS direto no Node
  const keyPath  = resolveCertPath(process.env.SSL_KEY_PATH);
  const certPath = resolveCertPath(process.env.SSL_CERT_PATH);

  if (!keyPath || !certPath) {
    logger.error('Defina SSL_KEY_PATH e SSL_CERT_PATH no .env.development');
    process.exit(1);
  }
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    logger.error(`Certificados não encontrados em ${keyPath} ou ${certPath}`);
    process.exit(1);
  }

  const sslOptions = {
    key:  fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  };

  https.createServer(sslOptions, app).listen(PORT, () => {
    logger.info('HTTPS pronto', { PORT, scheme: 'https', env: ENV });
    loadExistingSessions().catch(err =>
      logger.warn({ err: String(err?.message || err) }, 'Falha ao restaurar sessões')
    );
  });
}

bootstrap().catch(err => {
  logger.error({ err: String(err?.stack || err) }, 'Falha fatal no bootstrap');
  process.exit(1);
});

export default null;
