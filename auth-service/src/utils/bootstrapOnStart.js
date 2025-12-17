// src/utils/bootstrapOnStart.js
import mongoose from 'mongoose';
import logger from '../config/auth.logger.js';
import config from '../config/auth.config.js';
import { runAuthBootstrap } from './auth-bootstrap.js';
import { runDomainBootstrap } from './domain-bootstrap.js';

function defaultAuthMode() {
  if (config.env === 'production') return 'off';
  return 'missing';
}
function defaultDomainMode() {
  if (config.env === 'production') return 'off';
  return 'always'; // cria/garante dados de teste em dev/staging
}
// BOOTSTRAP_ON_START: off | missing | always
// BOOTSTRAP_DOMAIN_ON_START: off | always
const AUTH_MODE   = (process.env.BOOTSTRAP_ON_START || defaultAuthMode()).toLowerCase();
const DOMAIN_MODE = (process.env.BOOTSTRAP_DOMAIN_ON_START || defaultDomainMode()).toLowerCase();

async function waitMongoReady() {
  if (mongoose.connection.readyState === 1) return;
  await new Promise((resolve, reject) => {
    const onErr = err => { cleanup(); reject(err); };
    const onOk  = ()  => { cleanup(); resolve(); };
    const cleanup = () => {
      mongoose.connection.off('error', onErr);
      mongoose.connection.off('connected', onOk);
      mongoose.connection.off('open', onOk);
    };
    mongoose.connection.once('error', onErr);
    mongoose.connection.once('connected', onOk);
    mongoose.connection.once('open', onOk);
  });
}

async function collectionsState() {
  const required = ['users', 'groups', 'resources', 'groupresourcegrants'];
  const db = mongoose.connection.db;
  const existing = await db.listCollections().toArray();
  const have = new Set(existing.map(c => c.name.toLowerCase()));
  const missing = required.filter(n => !have.has(n));

  let usersCount = 0;
  try { usersCount = await mongoose.connection.collection('users').countDocuments(); }
  catch { usersCount = 0; }

  return { missing, usersCount };
}

export async function runBootstrapOnStart() {
  // 1) AUTH (admin e recursos SEMPRE criados, inclusive produção)
  if (AUTH_MODE !== 'off') {
    await waitMongoReady();
    const { missing, usersCount } = await collectionsState();
    const need = AUTH_MODE === 'always' || missing.length > 0 || usersCount === 0;
    if (need || config.env === 'production') {
      logger.info(`[bootstrap-auth] start mode=${AUTH_MODE} missing=${missing.join(',') || 'none'} users=${usersCount}`);
      await runAuthBootstrap({
        seedMode: process.env.SEED_MODE || (config.env === 'production' ? 'production' : 'no_production'),
        forceReset: String(process.env.SEED_FORCE_RESET_PASSWORD).toLowerCase() === 'true',
      });
      logger.info('[bootstrap-auth] done');
    }
  }

  // 2) DOMAIN (somente não-produtivo)
  if (DOMAIN_MODE !== 'off' && config.env !== 'production') {
    logger.info(`[bootstrap-domain] start mode=${DOMAIN_MODE}`);
    // idempotente → pode rodar sempre
    await runDomainBootstrap();
    logger.info('[bootstrap-domain] done');
  }
}
