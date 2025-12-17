import { createResilientHttpClient } from '../utils/resilientHttp.utils.js';
import logger from '../config/logger.js';
import SessionContext from '../models/sessionContext.model.js';
import { fetchAuthToken } from './auth.service.js';

const ADMIN_CONFIG_URL    = (process.env.APP_IA_ADMIN_CONFIGURATION_SERVICE_URL    || '').replace(/\/$/, '');
const CUSTOMER_CONFIG_URL = (process.env.APP_IA_CUSTOMER_CONFIGURATION_SERVICE_URL || '').replace(/\/$/, '');

const http = createResilientHttpClient();
http.interceptors.request.use(async cfg => {
  const token = await fetchAuthToken();
  cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}`, 'Content-Type':'application/json' };
  return cfg;
});

export async function getOrInitCtx(whatsappPhoneNumber, user){
  let ctx = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user });
  if(!ctx) ctx = await SessionContext.create({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, status:'PENDING' });
  return ctx;
}
export async function getAgentNameFromCtx(whatsappPhoneNumber, user){
  const ctxNow = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user }).lean();
  return ctxNow?.lastLog?.agent?.name || '';
}

export async function loadConfigsFromContextOrWhats(whatsappPhoneNumber, user){
  const ctx = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user });
  if (ctx?.status === 'VERIFIED' && ctx?.idAdminConfiguration) {
    const { data: admin } = await http.get(`${ADMIN_CONFIG_URL}/ia-admin-configurations/${ctx.idAdminConfiguration}`);
    // Tom equilibrado com emojis
    return { cust: { communicationType: 'neutral', welcomeMessageText: '✅ Identidade confirmada. Pronto para continuar! 😊\nSelecione uma opção abaixo:' }, admin };
  }
  const custUrl = `${CUSTOMER_CONFIG_URL}/ia-customer-configurations/whatsapp/${whatsappPhoneNumber}`;
  const { data: custArr } = await http.get(custUrl);
  if(!Array.isArray(custArr) || !custArr[0]) throw new Error('FalhaCustomerConfig');
  const cust = custArr[0];
  if(cust.status !== 'ativo') throw new Error('ContaInativa');
  const { data: admin } = await http.get(`${ADMIN_CONFIG_URL}/ia-admin-configurations/${cust.idAdminConfiguration}`);
  return { cust, admin };
}
