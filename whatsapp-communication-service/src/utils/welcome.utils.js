import Conversation from '../models/conversation.model.js';
import SessionContext from '../models/sessionContext.model.js';
import logger from '../config/logger.js';
import removeAccents from 'remove-accents';

const firstName = (s='') => String(s).trim().split(/\s+/)[0] || '';

export function buildSystemMsgs(cust, admin){
  const msgs = [{ role: 'system', content: cust?.communicationType === 'formal' ? 'IA deve usar um tom formal.' : 'IA deve usar um tom informal, acolhedor e próximo.' }];
  if (admin?.prompt) msgs.push({ role: 'system', content: admin.prompt });
  if (cust?.prompt)  msgs.push({ role: 'system', content: cust.prompt });
  if (typeof cust?.goodByeMessageText === 'string' && cust.goodByeMessageText?.trim()) msgs.push({ role: 'system', content: cust.goodByeMessageText });
  return msgs;
}

export async function welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName }){
  // Fallback: buscar nome do agente do contexto se não vier por parâmetro
  let displayName = agentName;
  if (!displayName) {
    try {
      const ctx = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user }).lean();
      displayName = ctx?.lastLog?.agent?.name || ctx?.agent?.name || '';
    } catch {}
  }
  const helloName = displayName ? `Olá, *${firstName(displayName)}* ! 👋` : 'Olá! 👋';
  const services = Array.isArray(admin?.services) ? admin.services : [];
  // Menu limpo e consistente
  const intro = '✅ Identidade confirmada, pronto para continuar!';
  const header = 'Digite o número da opção:';
  const list = services.length
    ? services.join('\n')
    : '1.Simular Financiamento Imobiliário\n2.Consultar Simulação Financiamento Imobiliário\n9.Dúvidas Gerais sobre nossos Serviços';
  const footer = '🔙 A qualquer momento, digite *Menu* para retornar ao menu Inicial.';
  const reply = `${helloName}\n\n${intro}\n${header}\n\n${list}\n\n${footer}`.trim();
  try { await Conversation.create({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: 'outbound', message: reply }); } catch(e){ logger.warn('[Welcome] Falha Conversation', e?.message || e); }
  return reply;
}

export function isRestartIntent(text){
  const s = removeAccents(String(text || '').toLowerCase());
  return /\b(?:nova|novo|iniciar|reiniciar|recomecar|reset|resetar|refazer)\s+(?:a\s+)?simulacao\b/.test(s)
      || /\bsimular\s+novamente\b/.test(s) || /\bcomecar\s+(?:do\s+)?zero\b/.test(s) || /\breiniciar\b/.test(s);
}

export function isMenuIntent(text){
  const s = removeAccents(String(text || '').toLowerCase());
  return /\bmenu\b/.test(s)
      || /\bmenu\s+inicial\b/.test(s)
      || /\bver\s+opcoes\b/.test(s)
      || /\bopcoes\b/.test(s)
      || /\bvoltar\s+ao\s+inicio\b/.test(s)
      || /\binicio\b/.test(s);
}
