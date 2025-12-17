import express from 'express';
import {authorizeAccessUser} from '../middlewares/authorizeAccessUser.js';
import {
  createGroupController,
  listGroupsController,
  getGroupByIdController,
  updateGroupController,
  deleteGroupController
} from '../controllers/group.controller.js';

const router = express.Router();

// Cria um novo grupo (só para usuários autenticados)
router.post('/', authorizeAccessUser, createGroupController);

// Lista todos os grupos
router.get('/', listGroupsController);

// Detalha grupo por ID
router.get('/:id', getGroupByIdController);

// Atualiza um grupo existente
router.put('/:id', authorizeAccessUser, updateGroupController);

// Remove um grupo
router.delete('/:id', authorizeAccessUser, deleteGroupController);

export default router;
