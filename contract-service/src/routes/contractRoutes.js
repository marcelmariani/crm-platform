// src/routes/contractRoutes.js
import { Router } from 'express';
import { validate } from '../validation/validate.js';
import { createContractSchema } from '../validation/contractSchemas.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import { buildRecursiveScopeAgent } from '../middlewares/buildRecursiveScopeAgent.js';
import {
  createcontractSchema,
  updatecontractSchema,
  idParamSchema,
  statusEndpointSchema,
  contractNumberParamSchema
} from '../validation/contractSchemas.js';

import {
  createcontract, getcontracts, getcontractById, getcontractByNumber, updatecontract, approvecontract, deletecontract,
  setDraft, setAwaitingDocuments, setInReview, setAwaitingSignatures, setSigned,
  setSubmittedToBank, setBankRequirements, setApproved, setRejected,
  setActive, setSettled, setCanceled, setExpired
} from '../controllers/contractController.js';

const router = Router();
const APP_RESOURCE_NAME = process.env.APP_RESOURCE_NAME || 'contract-service';

router.use(authorizeAccessUser, buildRecursiveScopeAgent);

router.post(
  '/contracts',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.CREATE),
  validate(createContractSchema),
  createcontract
);

router.get(
  '/contracts',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getcontracts
);

router.get(
  '/contracts/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  validate(idParamSchema),
  getcontractById
);

router.get(
  '/contracts/by-number/:number',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  validate(contractNumberParamSchema),
  getcontractByNumber
);

router.put(
  '/contracts/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(updatecontractSchema),
  updatecontract
);

router.post(
  '/contracts/:id/approve',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE),
  validate(idParamSchema),
  approvecontract
);

router.delete(
  '/contracts/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.DELETE),
  validate(idParamSchema),
  deletecontract
);

// ===== atalhos de status =====
const v = (s) => validate(idParamSchema.merge(statusEndpointSchema));

router.post('/contracts/:id/draft',               authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setDraft);
router.post('/contracts/:id/awaiting_documents',  authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setAwaitingDocuments);
router.post('/contracts/:id/in_review',           authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setInReview);
router.post('/contracts/:id/awaiting_signatures', authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setAwaitingSignatures);
router.post('/contracts/:id/signed',              authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setSigned);
router.post('/contracts/:id/submitted_to_bank',   authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setSubmittedToBank);
router.post('/contracts/:id/bank_requirements',   authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setBankRequirements);
router.post('/contracts/:id/approved',            authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setApproved);
router.post('/contracts/:id/rejected',            authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setRejected);
router.post('/contracts/:id/active',              authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setActive);
router.post('/contracts/:id/settled',             authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setSettled);
router.post('/contracts/:id/canceled',            authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setCanceled);
router.post('/contracts/:id/expired',             authorizeGroupResource(APP_RESOURCE_NAME, PERM.UPDATE), v(), setExpired);

export default router;
