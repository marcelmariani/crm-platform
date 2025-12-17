// src/routes/authRoutes.js
import express from 'express';
import { authorizeAccessUser } from '../middlewares/authorizeAccessUser.js';
import { authorizeAccessAdmin } from '../middlewares/authorizeAccessAdmin.js';

import {
  registerUserController as register,
  loginController as login,
  listUsersController as listUsersController,
  getUserByIdController as getUserByIdController,
  impersonateAgentController as impersonateAgent
} from '../controllers/auth.controller.js';

const router = express.Router();

// Registro de usuário: somente admin autenticado
router.post('/register', authorizeAccessUser, authorizeAccessAdmin, register);

// Login do usuário
router.post('/login', login);

// Listagem de usuários: somente admin autenticado
router.get('/users', authorizeAccessUser, authorizeAccessAdmin, listUsersController);

// Buscar usuário por ID: somente admin autenticado
router.get('/users/:id', authorizeAccessUser, authorizeAccessAdmin, getUserByIdController);

// Impersonação de agente: somente admin autenticado
router.post('/impersonate', authorizeAccessUser, authorizeAccessAdmin, impersonateAgent);

// Identidade do token atual
router.get('/me', authorizeAccessUser, (req, res) => {
  const { sub, group, userName, iat, exp, jti } = req.user || {};
  res.json({ _id: sub, userName, groupId: group, iat, exp, jti });
});

export default router;