import logger from '../config/customerConfiguration.logger.js';
import { activate, deactivate } from '../services/customerConfigurationSessionStatus.service.js';

/**
 * Enfileira a ativação da sessão para um número de WhatsApp.
 */
export async function activateSession(req, res, next) {
  try {
    const { whatsappPhoneNumber } = req.body;
    //logger.info('Ativando sessão', { whatsappPhoneNumber });
    const result = await activate(whatsappPhoneNumber);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Enfileira a desativação da sessão para um número de WhatsApp.
 */
export async function deactivateSession(req, res, next) {
  try {
    const { whatsappPhoneNumber } = req.body;
    //logger.info('Desativando sessão', { whatsappPhoneNumber });
    const result = await deactivate(whatsappPhoneNumber);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
