// src/routes/proposalStatusRoutes.js
import express from 'express';
import {
  listStatuses,
  getStatus,
  createStatus,
  updateStatus,
  deleteStatus
} from '../controllers/proposalStatusController.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = express.Router();

// Autenticação sempre
router.use(authorizeAccessUser);

// Leitura: qualquer usuário autenticado
router.get('/proposal-status', listStatuses);
router.get('/proposal-status/:id', getStatus);

// Escrita: somente admin
router.post('/proposal-status', authorizeAccessAdmin, createStatus);
router.put('/proposal-status/:id', authorizeAccessAdmin, updateStatus);
router.delete('/proposal-status/:id', authorizeAccessAdmin, deleteStatus);

export default router;
