// src/routes/healthRoutes.js
import { Router } from 'express';
import mongoose from 'mongoose';

const router = Router();

router.get('/', (_req, res) => {
  const mongo = mongoose?.connection?.readyState ?? 0; // 0=disconnected, 1=connected
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    mongoState: mongo
  });
});

export default router;
