// src/routes/configuration.route.js
import { Router } from 'express';
import {
  createAdminConfiguration,
  getAdminConfigurations,
  getAdminConfigurationById,
  updateAdminConfiguration,
  deleteAdminConfiguration
} from '../controllers/adminConfiguration.controller.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ia-admin-configuration-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Aplica autenticação JWT em todas as rotas
router.use(authorizeAccessUser);

router.post('/ia-admin-configurations', authorizeAccessAdmin, createAdminConfiguration);
router.get('/ia-admin-configurations', authorizeAccessAdmin, getAdminConfigurations);
router.get('/ia-admin-configurations/:id', authorizeAccessAdmin, getAdminConfigurationById);
router.put('/ia-admin-configurations/:id', authorizeAccessAdmin, updateAdminConfiguration);
router.delete('/ia-admin-configurations/:id', authorizeAccessAdmin, deleteAdminConfiguration);

export default router;
