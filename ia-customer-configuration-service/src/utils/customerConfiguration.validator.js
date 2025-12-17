import Joi from 'joi';

const objectIdPattern = /^[0-9a-fA-F]{24}$/;

export const customerConfigurationSchema = Joi.object({
  name: Joi.string().min(3).required(),
  idAdminConfiguration: Joi.string().pattern(objectIdPattern).required(),
  prompt: Joi.string().required(),
  whatsappPhoneNumber: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
  welcomeMessage: Joi.boolean().default(false),
  goodByeMessage: Joi.boolean().default(false),
  communicationType: Joi.string().valid('formal', 'informal').required(),
  status: Joi.string().valid('created', 'active', 'inactive').default('created')
}).options({ stripUnknown: true, abortEarly: false });
