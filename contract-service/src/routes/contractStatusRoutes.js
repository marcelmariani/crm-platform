// src/routes/contractStatusRoutes.js
import { Router } from 'express';
import ContractStatus from '../models/contractStatus.js';

const router = Router();

router.get('/contract-statuses', async (_req, res) => {
  const rows = await ContractStatus.find({ $or: [{ isActive: true }, { status: 'active' }] })
    .sort({ key: 1 })
    .lean();
  res.json(rows);
});

router.get('/contract-statuses/:key', async (req, res) => {
  const row = await ContractStatus.findOne({ key: String(req.params.key).toLowerCase() }).lean();
  if (!row) return res.status(404).json({ message: 'Status não encontrado' });
  res.json(row);
});

export default router;
