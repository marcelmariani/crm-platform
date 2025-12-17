import { Router } from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeGroupResource, PERM } from '../middlewares/authorizeGroupResource.js';
import {
  createBankCorrespondent,
  getBankCorrespondents,
  getBankCorrespondentById,
  updateBankCorrespondent,
  deleteBankCorrespondent,
  getBankCorrespondentByOwner,
  getBankCorrespondentByGroup,
} from '../controllers/bankCorrespondent.controller.js';

const router = Router();
const APP_RESOURCE_NAME = process.env.APP_RESOURCE_NAME || 'bank-correspondent-service';

// Health check - não requer autenticação
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'bank-correspondent-service',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// exige usuário autenticado
router.use(authorizeAccessUser);

// CREATE: somente admin (perm CREATE)
router.post(
  '/bank-correspondents',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.CREATE),
  createBankCorrespondent
);

// LIST/GET: leitura normal
router.get(
  '/bank-correspondents',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getBankCorrespondents
);
router.get(
  '/bank-correspondents/by-owner/:ownerAuthId?',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getBankCorrespondentByOwner
);
router.get(
  '/bank-correspondents/by-group/:groupId',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getBankCorrespondentByGroup
);
router.get(
  '/bank-correspondents/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  getBankCorrespondentById
);

// UPDATE/DELETE: usa gate READ e deixa o controller validar se é owner ou ALL
router.put(
  '/bank-correspondents/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  updateBankCorrespondent
);
router.delete(
  '/bank-correspondents/:id',
  authorizeGroupResource(APP_RESOURCE_NAME, PERM.READ),
  deleteBankCorrespondent
);

export default router;
