// lambda.js
import serverless from 'serverless-http';
import { createServer } from './src/index.js';

// Cria a aplicação Express
const app = createServer();

// Exporta o handler do Lambda
export const handler = serverless(app, {
  // Configurações opcionais
  request(request, event, context) {
    // Adiciona informações do evento Lambda ao request se necessário
    request.context = context;
    request.event = event;
  }
});
