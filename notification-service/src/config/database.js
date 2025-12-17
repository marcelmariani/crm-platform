import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

let mongodFallback; // para manter referência se criado internamente

async function initDatabase() {
  mongoose.set('strictQuery', true);
  if (config.env === 'production') mongoose.set('autoIndex', false);
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.debug('Mongo já está conectado ou em processo de conexão; pulando initDatabase.');
    return;
  }

  let uri = config.mongoUri;
  let mongodb = config.mongoDB;

  if (config.env === 'test') {
    if (process.env.MONGODB_URI) {
      uri = process.env.MONGODB_URI;
      logger.info(`🧪 Usando MONGODB_URI fornecido em teste: ${uri}`);
    } else {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodFallback = await MongoMemoryServer.create();
      uri = mongodFallback.getUri();
      logger.info(`🧪 Usando MongoMemoryServer (fallback) em ${uri}`);
    }
  }

  const opts = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
  };
  await mongoose.connect(uri, opts);
  logger.info(`Conectado ao MongoDB em ${mongodb}`);
}

initDatabase().catch(err => {
  logger.error(`Erro de conexão ao MongoDB: ${err.message}`);
  throw err;
});

// Expõe função para encerrar a conexão do mongoose e parar o MongoMemoryServer
async function closeDatabase() {
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
  if (mongodFallback) {
    await mongodFallback.stop();
    mongodFallback = undefined;
  }
}

export { closeDatabase };
export default mongoose;
