import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import { buildRecursiveScopeAgent } from '../middlewares/buildRecursiveScopeAgent.js';

import {
  createContact,
  getContacts,
  getContactById,
  getContactByDocumentNumber,
  updateContact,
  deleteContact,
  qualifyContact
} from '../controllers/contactController.js';

const router = Router();
const RESOURCE = process.env.APP_RESOURCE_NAME;

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'contact-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.use(authorizeAccessUser, buildRecursiveScopeAgent);

router.post('/contacts', authorizeGroupResource(RESOURCE, PERM.CREATE), createContact);
router.get('/contacts', authorizeGroupResource(RESOURCE, PERM.READ), getContacts);
router.get('/contacts/document/:documentNumber', authorizeGroupResource(RESOURCE, PERM.READ), getContactByDocumentNumber);
router.get('/contacts/:id', authorizeGroupResource(RESOURCE, PERM.READ), getContactById);
router.put('/contacts/:id', authorizeGroupResource(RESOURCE, PERM.UPDATE), updateContact);
router.patch('/contacts/:id/qualification', authorizeGroupResource(RESOURCE, PERM.UPDATE), qualifyContact);
router.delete('/contacts/:id', authorizeGroupResource(RESOURCE, PERM.DELETE), deleteContact);

export default router;
