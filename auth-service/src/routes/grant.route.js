// auth-service/src/routes/grantRoutes.js
import { Router } from 'express';
import { upsertGrant, listGrants, getEffectiveGrant } from '../controllers/grant.controller.js';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

const router = Router();

// Todas as rotas exigem usuário autenticado
router.use(authorizeAccessUser);

// Somente admins podem criar ou listar grants
router.put('/', authorizeAccessAdmin, upsertGrant); // upsert por {groupId, resourceId|resourceName}
router.get('/', authorizeAccessAdmin, listGrants);
// Qualquer usuário autenticado pode consultar grant efetivo
router.get('/effective', getEffectiveGrant); // ?groupId=&resourceId= | &resourceName=

export default router;
