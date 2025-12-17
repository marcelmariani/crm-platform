// src/config/database.js
import mongoose from 'mongoose';
import logger from './logger.js';

mongoose.set('bufferCommands', false);

const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

/**
 * Conecta ao MongoDB usando Mongoose e aguarda a conexão antes de retornar.
 * Em caso de falha no Lambda, lança erro. Em ambiente local, tenta novamente.
 */
export async function connectDatabase() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: isLambda ? 3000 : 5000,
    });
    logger.info(`Conectado ao MongoDB, acessando ${process.env.MONGO_DATABASE} database`);

  } catch (err) {
    logger.error(`Erro de conexão MongoDB: ${err.message}`);
    
    // No Lambda, falha imediatamente
    if (isLambda) {
      throw err;
    }
    
    // Local: tenta novamente
    logger.info('Tentando novamente em 5s');
    setTimeout(connectDatabase, 5000);
  }
}

export default mongoose;
