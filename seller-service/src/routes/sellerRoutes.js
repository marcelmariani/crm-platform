//sellerRoutes.js
import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import { buildRecursiveScopeAgent } from '../middlewares/buildRecursiveScopeAgent.js';

import {
  createseller,
  getsellers,
  getsellerById,
  updateseller,
  deleteseller,
  patchSellerStatus,
} from '../controllers/sellerController.js';

const router = Router();
const RESOURCE = process.env.APP_RESOURCE_NAME;

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'seller-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

router.use(authorizeAccessUser, buildRecursiveScopeAgent);

router.post('/sellers', authorizeGroupResource(RESOURCE, PERM.CREATE), createseller);
router.get('/sellers', authorizeGroupResource(RESOURCE, PERM.READ), getsellers);
router.get('/sellers/:id', authorizeGroupResource(RESOURCE, PERM.READ), getsellerById);
router.put('/sellers/:id', authorizeGroupResource(RESOURCE, PERM.UPDATE), updateseller);
router.patch('/sellers/:id/status', authorizeGroupResource(RESOURCE, PERM.UPDATE), patchSellerStatus);
router.delete('/sellers/:id', authorizeGroupResource(RESOURCE, PERM.DELETE), deleteseller);

export default router;
