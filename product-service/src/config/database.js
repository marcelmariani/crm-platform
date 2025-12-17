/* === D:\SmartIASystems\product-service\src\config\database.js === */
// src/config/database.js
import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';

let mongodFallback;

async function initDatabase() {
  mongoose.set('strictQuery', true);
  if (mongoose.connection && mongoose.connection.readyState !== 0) {
    logger.info('Mongo já está conectado; pulando initDatabase.');
    return;
  }

  let uri = config.mongoUri;

  if (config.env === 'test') {
    if (process.env.MONGODB_URI) {
      uri = process.env.MONGODB_URI;
      logger.info(`🧪 Usando MONGODB_URI em teste: ${uri}`);
    } else {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongodFallback = await MongoMemoryServer.create();
      uri = mongodFallback.getUri();
      logger.info(`🧪 Usando MongoMemoryServer em ${uri}`);
    }
  }

  await mongoose.connect(uri, config.mongoDB ? { dbName: config.mongoDB } : undefined);

  const name =
    mongoose.connection?.name ||
    mongoose.connection?.client?.options?.dbName ||
    config.mongoDB ||
    '(desconhecido)';
  const host = mongoose.connection?.host || 'localhost';
  logger.info(`Conectado ao MongoDB "${name}" em ${host}`);
}

initDatabase().catch(err => {
  logger.error(`Erro de conexão ao MongoDB: ${err.message}`);
  throw err;
});

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
