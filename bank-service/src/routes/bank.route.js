import express from 'express';
import {
  createBank,
  getBanks,
  getBankById,
  updateBank,
  deleteBank
} from '../controllers/bank.controller.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';


const router = express.Router();

// Health check público
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Bank service is healthy' });
});

// Autenticação sempre
router.use(authorizeAccessUser);

// Leitura: qualquer usuário autenticado
router.get('/banks', getBanks);
router.get('/banks/:id', getBankById);

// Escrita: somente admin
router.post('/banks', authorizeAccessAdmin, createBank);
router.put('/banks/:id', authorizeAccessAdmin, updateBank);
router.delete('/banks/:id', authorizeAccessAdmin, deleteBank);

export default router;
