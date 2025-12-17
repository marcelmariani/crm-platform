// src/services/agent.service.js
import Agent from '../models/agent.model.js';

const normalizePhone = v => String(v || '').replace(/\D/g, '');

export async function getActiveByPhoneNumber(phoneNumber, { hint = false } = {}) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return null;

  const q = Agent.findOne({ phoneNumber: phone, status: 'active' }).lean();
  if (hint) q.hint({ phoneNumber: 1, status: 1 }); // opcional

  return q;
}

export async function explainActiveByPhoneNumber(phoneNumber) {
  const phone = normalizePhone(phoneNumber);
  if (!phone) return null;

  return Agent.findOne({ phoneNumber: phone, status: 'active' })
    .lean()
    .hint({ phoneNumber: 1, status: 1 })
    .explain('executionStats');
}
