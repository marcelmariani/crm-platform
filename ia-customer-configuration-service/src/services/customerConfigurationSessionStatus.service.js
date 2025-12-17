import createError from 'http-errors';
import { CustomerConfiguration } from '../models/customerConfiguration.model.js'; // caminho correto

export async function activate(phoneNumber) {
  if (!phoneNumber) throw createError(400, 'whatsappPhoneNumber é obrigatório');

  const config = await CustomerConfiguration.findOne({ whatsappPhoneNumber: phoneNumber });
  if (!config) throw createError(404, 'Registro não encontrado');

  if (config.status === 'active') {
    return { whatsappPhoneNumber: phoneNumber, status: 'active', changed: false };
  }
  config.status = 'active'; // created → active (permitido pelo FSM)
  await config.save();
  return { whatsappPhoneNumber: phoneNumber, status: 'active', changed: true };
}

export async function deactivate(phoneNumber) {
  if (!phoneNumber) throw createError(400, 'whatsappPhoneNumber é obrigatório');

  const config = await CustomerConfiguration.findOne({ whatsappPhoneNumber: phoneNumber });
  if (!config) throw createError(404, 'Registro não encontrado');

  if (config.status === 'inactive') {
    return { whatsappPhoneNumber: phoneNumber, status: 'inactive', changed: false };
  }
  config.status = 'inactive'; // active → inactive (permitido)
  await config.save();
  return { whatsappPhoneNumber: phoneNumber, status: 'inactive', changed: true };
}
