import serverless from 'serverless-http';
import { createServer } from './src/index.js';

// Cria app Express sem iniciar servidor
const app = createServer();

// Wrap para Lambda com suporte a módulos ES6
export const handler = serverless(app, {
  // Otimizações para cold start
  binary: ['image/*', 'application/pdf'],
  request(request, event, context) {
    // Adiciona informações do Lambda ao request
    request.context = context;
    request.event = event;
  }
});
