// src/routes/realEstateRoutes.js
import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import authorizeAccessGroupAdmin from '../middlewares/authorizeAccessGroupAdmin.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import buildRecursiveScopeRealEstate from '../middlewares/buildRecursiveScopeRealEstate.js';
import {
  createRealEstate,
  getRealEstates,
  getRealEstateById,
  updateRealEstate,
  deleteRealEstate,
  getRealEstateIds,
  getRealEstateByGroup,
  getRealEstateByCorrespondent,
} from '../controllers/realEstate.controller.js';

const router = Router();
const APP_RESOURCE_NAME = process.env.APP_RESOURCE_NAME || 'real-estate';

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'real-estate-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// Auth + admin flag + escopo antes de qualquer rota
router.use(authorizeAccessUser, authorizeAccessGroupAdmin, buildRecursiveScopeRealEstate);

// Rotas auxiliares de leitura (específicas primeiro)
router.get('/real-estates/by-group/:groupId', getRealEstateByGroup);
router.get('/real-estates/by-correspondent/:bankCorrespondentId', getRealEstateByCorrespondent);
router.get('/real-estates/ids', getRealEstateIds);

// CRUD
router.post(
  '/real-estates',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.CREATE),
  createRealEstate
);
router.put(
  '/real-estates/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  updateRealEstate
);
router.patch(
  '/real-estates/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  updateRealEstate
);
router.delete(
  '/real-estates/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.DELETE),
  deleteRealEstate
);

// Leituras gerais
router.get('/real-estates/:id', getRealEstateById);
router.get('/real-estates', getRealEstates);

export default router;
