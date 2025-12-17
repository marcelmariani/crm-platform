// src/config/database.js
import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

let mongodFallback; // referência do MongoMemoryServer em testes

function maskUri(u = '') {
  try {
    const url = new URL(u);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return u || '';
  }
}

async function initDatabase() {
  mongoose.set('strictQuery', true);

  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.info('Mongo já conectado ou conectando; ignorando initDatabase.');
    return;
  }

  let uri = config.mongoUri;
  const dbName = config.mongoDB;

  if (config.env === 'test') {
    if (process.env.MONGO_URI) {
      uri = process.env.MONGO_URI;
      logger.info(`🧪 Usando MONGO_URI em teste: ${maskUri(uri)}`);
    } else {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodFallback = await MongoMemoryServer.create();
      uri = mongodFallback.getUri();
      logger.info(`🧪 Usando MongoMemoryServer (fallback) em ${uri}`);
    }
  } else {
    if (!uri) {
      const msg =
        'MONGO_URI não configurado. Defina em .env.' +
        (config.env ? ` Ambiente: ${config.env}` : '');
      logger.error(msg);
      throw new Error(msg);
    }
  }

  // Conecta. Se MONGO_DATABASE foi informado, força dbName.
  await mongoose.connect(uri, dbName ? { dbName } : undefined);

  const name =
    mongoose.connection?.name ||
    dbName ||
    mongoose.connection?.db?.databaseName ||
    '';
  logger.info(
    `Conectado ao MongoDB (${maskUri(uri)}) db="${name}"`
  );
}

initDatabase().catch((err) => {
  logger.error(`Erro de conexão ao MongoDB: ${err.message}`);
  throw err;
});

// Saúde para /ready
export async function healthMongo() {
  return mongoose.connection?.readyState === 1;
}

// Encerramento limpo (ex.: testes)
export async function closeDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongodFallback) {
    await mongodFallback.stop();
    mongodFallback = undefined;
  }
}

export default mongoose;
