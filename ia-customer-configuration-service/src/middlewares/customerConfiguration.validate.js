import { customerConfigurationSchema } from '../utils/customerConfiguration.validator.js';
import logger from '../config/customerConfiguration.logger.js';
import { ensureAdminConfigExists } from '../clients/customerConfiguration.adminConfiguration.client.js';

export async function validateCustomerConfiguration(req, res, next) {
  try {
    const { error, value } = customerConfigurationSchema.validate(req.body);
    if (error) {
      logger.warn('Payload inválido para CustomerConfiguration', { errors: error.details });
      const messages = error.details.map(d => d.message).join('; ');
      return res.status(400).json({ message: messages });
    }

    // valida a referência externa
    await ensureAdminConfigExists(value.idAdminConfiguration, req.headers.authorization);

    req.body = value;
    return next();
  } catch (err) {
    return next(err);
  }
}
