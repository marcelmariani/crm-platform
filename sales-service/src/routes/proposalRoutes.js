// src/routes/proposalRoutes.js
import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import { buildRecursiveScopeAgent } from '../middlewares/buildRecursiveScopeAgent.js';
import { validate } from '../validation/validate.js';
import {
  createProposalSchema,
  updateProposalSchema,
  idParamSchema,
  proposalNumberParamSchema,
  buyerCpfQuerySchema,
} from '../models/proposalSchemas.js';

import {
  createProposal, getProposals, getProposalById, updateProposal, approveProposal, deleteProposal,
  setCreated, setEditing, setUnderAnalysis, setAnalysisDone, setCancelled, setFinalized,
  getProposalByNumber, getProposalsByBuyerCpf
} from '../controllers/proposalController.js';
import { statusEndpointSchema } from '../models/proposalSchemas.js';

const router = Router();
const APP_RESOURCE_NAME = process.env.APP_RESOURCE_NAME || 'sales-service';

router.use(authorizeAccessUser, buildRecursiveScopeAgent);

router.post(
  '/proposals',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.CREATE),
  validate(createProposalSchema),
  createProposal
);

router.get(
  '/proposals',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getProposals
);

// Consulta por número da proposta (padded ou número)
router.get(
  '/proposals/number/:number',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  validate(proposalNumberParamSchema),
  getProposalByNumber
);

// Consulta por CPF do comprador
router.get(
  '/proposals/by-buyer',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  validate(buyerCpfQuerySchema),
  getProposalsByBuyerCpf
);

router.get(
  '/proposals/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  validate(idParamSchema),
  getProposalById
);

router.put(
  '/proposals/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(updateProposalSchema),
  updateProposal
);

router.post(
  '/proposals/:id/approve',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema),
  approveProposal
);

router.delete(
  '/proposals/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.DELETE),
  validate(idParamSchema),
  deleteProposal
);

router.post(
  '/proposals/:id/created',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setCreated
);

router.post(
  '/proposals/:id/editing',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setEditing
);

router.post(
  '/proposals/:id/under_analysis',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setUnderAnalysis
);

router.post(
  '/proposals/:id/analysis_completed',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setAnalysisDone
);

router.post(
  '/proposals/:id/cancelled',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setCancelled
);

router.post(
  '/proposals/:id/finalized',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema.merge(statusEndpointSchema)),
  setFinalized
);

export default router;
