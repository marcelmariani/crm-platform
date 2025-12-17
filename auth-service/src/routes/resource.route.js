import express from 'express';
import {authorizeAccessAdmin} from '../middlewares/authorizeAccessAdmin.js';
import {authorizeAccessUser} from '../middlewares/authorizeAccessUser.js';
import {
  createResourceController,
  listResourcesController,
  getResourceByIdController,
  getResourceByNameController,
  updateResourceController,
  deleteResourceController
} from '../controllers/resource.controller.js';

const router = express.Router();

router.use(authorizeAccessUser);

router.post('/',                 authorizeAccessAdmin, createResourceController);
router.get('/',                  authorizeAccessAdmin, listResourcesController);
router.get('/by-name/:resourceName', authorizeAccessAdmin, getResourceByNameController);
router.get('/:id',               authorizeAccessAdmin, getResourceByIdController);
router.put('/:id',               authorizeAccessAdmin, updateResourceController);
router.delete('/:id',            authorizeAccessAdmin, deleteResourceController);

export default router;
