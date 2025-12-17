// src/routes/productRoutes.js
import { Router } from 'express';
import {
  findAll, findById, create, update, partialUpdate, remove,
  activate, deactivate
} from '../controllers/productController.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'product-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// leitura - exige autenticação user
router.get('/products', authorizeAccessUser, findAll);
router.get('/products/:id', authorizeAccessUser, findById);

// escrita somente admin
router.post('/products', authorizeAccessAdmin, create);
router.put('/products/:id', authorizeAccessAdmin, update);
router.patch('/products/:id', authorizeAccessAdmin, partialUpdate);
router.delete('/products/:id', authorizeAccessAdmin, remove);

// status
router.patch('/products/:id/activate', authorizeAccessAdmin, activate);
router.patch('/products/:id/deactivate', authorizeAccessAdmin, deactivate);

export default router;
