// src/config/database.js
import mongoose from 'mongoose';
import config from './auth.config.js';
import logger from './auth.logger.js';

let mongodFallback;

async function initDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.info('Mongo já está conectado ou conectando; pulando initDatabase.');
    return;
  }

  let uri = config.mongoUri;
  let dbName = config.mongoDB;

  // Sanitizar URI mongodb+srv (não pode ter porta)
  if (uri && uri.startsWith('mongodb+srv://')) {
    uri = uri.replace(/:(\d+)\//, '/');
    if (uri !== config.mongoUri) {
      logger.warn('⚠️  Porta removida de mongodb+srv URI (SRV não permite porta explícita)');
    }
  }

  if (config.env === 'test') {
    if (process.env.MONGODB_URI) {
      uri = process.env.MONGODB_URI;
      logger.info(`🧪 Usando MONGODB_URI fornecido em teste: ${uri}`);
    } else {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodFallback = await MongoMemoryServer.create();
      uri = mongodFallback.getUri();
      dbName = undefined; // memória já inclui db
      logger.info(`🧪 Usando MongoMemoryServer (fallback) em ${uri}`);
    }
  }

  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  logger.info(`Conectado ao MongoDB${dbName ? ` db=${dbName}` : ''}`);
}

initDatabase().catch(err => {
  logger.error(`Erro de conexão ao MongoDB: ${err.message}`);
  throw err;
});

export default mongoose;
