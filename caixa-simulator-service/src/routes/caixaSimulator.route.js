// src/routes/caixaSimulator.route.js
import express from 'express';
import {
  createJob,
  getJob,
  getSimulationById,
} from '../controllers/caixaSimulator.controller.js';
import { healthCheck } from '../controllers/health.controller.js';

const router = express.Router();


// Health check (sem autenticação)
router.get('/health', healthCheck);

// Inicia job (nota: barra final aceita)
router.post('/simulator-caixa/job/', createJob);

// Consulta job
router.get('/simulator-caixa/job/:jobId', getJob);

// Consulta simulação pelo _id do Mongo
router.get('/simulator-caixa/simulation/:id', getSimulationById);

export default router;
