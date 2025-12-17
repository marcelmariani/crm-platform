import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

// Configura strictQuery para evitar deprecation warning
mongoose.set('strictQuery', false);

let mongodFallback;

async function initDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.info('Mongo já está conectado ou conectando; pulando initDatabase.');
    return;
  }

  let uri = config.mongoUri;
  let dbName = config.mongoDB;

  // Se não houver URI configurada, não tenta conectar (útil em Lambda/health)
  if (!uri || uri.trim().length === 0) {
    logger.warn('MONGO_URI não definido; pulando conexão com MongoDB.');
    return;
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

  try {
    await mongoose.connect(uri, dbName ? { dbName } : undefined);
    logger.info(`Conectado ao MongoDB${dbName ? ` db=${dbName}` : ''}`);
  } catch (err) {
    // Não derruba o processo em ambientes sem DB; apenas loga erro
    logger.error(`Falha ao conectar ao MongoDB: ${err.message}`);
  }
}

initDatabase().catch(err => {
  // Evita lançar para não quebrar health em Lambda
  logger.error(`Erro de conexão ao MongoDB (ignorado): ${err.message}`);
});

export default mongoose;
