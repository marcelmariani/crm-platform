import { Router } from 'express';
import {
  createCustomerConfiguration,
  getCustomerConfigurations,
  getCustomerConfigurationById,
  updateCustomerConfiguration,
  deleteCustomerConfiguration,
  getCustomerConfigurationByPhone,
  updateCustomerConfigurationByPhone,
  deleteCustomerConfigurationByPhone
} from '../controllers/customerConfiguration.controller.js';
import { validateCustomerConfiguration } from '../middlewares/customerConfiguration.validate.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = Router();

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'ia-customer-configuration-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// autenticação do usuário (todas as rotas abaixo, exceto /health)
router.use(authorizeAccessUser);

// apenas admins
router.use(authorizeAccessAdmin);

// CRUD por ID
router.post('/ia-customer-configurations',  validateCustomerConfiguration, createCustomerConfiguration);
router.get('/ia-customer-configurations',   getCustomerConfigurations);
router.get('/ia-customer-configurations/:id', getCustomerConfigurationById);
router.put('/ia-customer-configurations/:id', validateCustomerConfiguration, updateCustomerConfiguration);
router.delete('/ia-customer-configurations/:id', deleteCustomerConfiguration);

// Operações por número de WhatsApp
router.get('/ia-customer-configurations/whatsapp/:whatsappPhoneNumber', getCustomerConfigurationByPhone);
router.put('/ia-customer-configurations/whatsapp/:whatsappPhoneNumber', validateCustomerConfiguration, updateCustomerConfigurationByPhone);
router.delete('/ia-customer-configurations/whatsapp/:whatsappPhoneNumber', deleteCustomerConfigurationByPhone);

export default router;
