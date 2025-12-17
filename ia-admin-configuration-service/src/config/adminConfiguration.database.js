// src/config/database.js
import mongoose from 'mongoose';
import config from './adminConfiguration.config.js';
import logger from './adminConfiguration.logger.js';

let mongodFallback; // referência se usarmos MongoMemoryServer em testes

async function initDatabase() {
  mongoose.set('strictQuery', true);

  // evita reconexão se já conectado ou conectando
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.debug('Mongo já conectado ou conectando; pulando initDatabase.');
    return;
  }

  let uri = config.mongoUri;
  const dbName = config.mongoDB;

  // comportamento especial em testes
  if (config.env === 'test') {
    if (process.env.MONGODB_URI) {
      uri = process.env.MONGODB_URI;
      logger.info(`🧪 Usando MONGODB_URI em teste: ${uri}`);
    } else {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodFallback = await MongoMemoryServer.create();
      uri = mongodFallback.getUri();
      logger.info(`🧪 Usando MongoMemoryServer (fallback) em ${uri}`);
    }
  }

  await mongoose.connect(uri);
  logger.info(`Conectado ao MongoDB em ${dbName}`);
}

initDatabase().catch(err => {
  logger.error(`Erro de conexão ao MongoDB: ${err.message}`);
  throw err;
});

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
