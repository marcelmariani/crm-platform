import SessionContext from "../models/sessionContext.model.js";
import removeAccents from "remove-accents";
import { askChatGPT } from "./chatgpt.service.js";
import logger from "../config/logger.js";

function formatConcise(text) {
  const maxChars = Number(process.env.DOUBTS_MAX_CHARS || 360);
  const maxLines = Number(process.env.DOUBTS_MAX_LINES || 6);
  let t = String(text || "").trim();
  // Remove cumprimentos/rodapés comuns
  t = t.replace(/^((ol[aá])|bom\s*d[ií]a|boa\s*noite|boa\s*tarde)[,!\s-]*/i, "");
  // Normaliza espaços
  t = t.replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ");
  // Limita linhas
  const lines = t.split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  t = lines.join("\n");
  // Limita caracteres
  if (t.length > maxChars) t = t.slice(0, maxChars).trim();
  return t;
}

async function getCtx(whats, user){
  let ctx = await SessionContext.findOne({ whatsappPhoneNumber: whats, whatsappPhoneNumberUser: user }).catch(() => null);
  if (!ctx) {
    ctx = new SessionContext({ whatsappPhoneNumber: whats, whatsappPhoneNumberUser: user, status: "VERIFIED" });
    await ctx.save();
  }
  return ctx;
}

export async function startDoubts(whats, user){
  const ctx = await getCtx(whats, user);
  ctx.doubts = { step: "askQuestion" };
  await ctx.save();
  const prompt = "🧠 Dúvidas Gerais sobre nossos Serviços\nPor favor, escreva sua pergunta:";
  try {
    logger.info(`[Dúvidas] Fluxo iniciado`, { msisdn: whats, user });
  } catch {}
  return prompt;
}

export async function abortDoubts(whats, user){
  try {
    const ctx = await getCtx(whats, user);
    ctx.doubts = undefined;
    await ctx.save();
  } catch {}
}

export async function handleDoubtsAnswer(whats, user, text){
  const ctx = await getCtx(whats, user);
  if (!ctx?.doubts) return null;
  const step = ctx.doubts.step;
  if (step !== "askQuestion") return null;

  const userQuestion = String(text || "").trim();
  if (!userQuestion) {
    try { logger.info(`[Dúvidas] Pergunta vazia solicitada novamente`, { msisdn: whats, user }); } catch {}
    return "Pode escrever sua dúvida?";
  }

  const systemMsgs = [];
  const tone = ctx?.cust?.communicationType === 'formal' ? 'Use tom formal.' : 'Use tom amigável, acolhedor e claro.';
  systemMsgs.push({ role: 'system', content: tone });
  // Regras de escopo e fonte
  systemMsgs.push({ role: 'system', content: "Você é uma IA do CCA que responde APENAS dúvidas relacionadas aos serviços prestados pelo CCA, com base EXCLUSIVA nas informações públicas do site da Caixa Econômica Federal (CAIXA). Se a pergunta não estiver relacionada ao CCA, a serviços de correspondente bancárioou mencionar outro banco/instituição ou tema fora de escopo, responda: 'Desculpe, só posso ajudar com dúvidas sobre os serviços do CCA baseadas nas informações da CAIXA.'" });
  systemMsgs.push({ role: 'system', content: "Ao responder, cite o tópico da CAIXA quando possível e mantenha linguagem simples e amigável. Não invente informações. Se não encontrar na CAIXA, diga que não localizou a informação na fonte oficial." });
  // Brevidade e formato
  systemMsgs.push({ role: 'system', content: "Responda de forma precisa e objetiva, em até 6 linhas. Prefira bullets curtos quando apropriado. Evite texto longo, repetições e rodeios. Não inclua cumprimentos nem rodapés." });
  // Hint de busca
  systemMsgs.push({ role: 'system', content: "Fonte única: site da Caixa Econômica Federal (www.caixa.gov.br)." });

  const messages = [
    ...systemMsgs,
    { role: 'user', content: userQuestion }
  ];

  try {
    logger.info(`[Dúvidas] Chamando ChatGPT`, { msisdn: whats, user, questionPreview: userQuestion.slice(0, 120) });
    const resp = await askChatGPT({ messages });
    const concise = formatConcise(resp);
    logger.info(`[Dúvidas] Resposta obtida`, { msisdn: whats, user, answerPreview: String(concise||'').slice(0, 120), answerLen: String(concise||'').length, maxChars: Number(process.env.DOUBTS_MAX_CHARS || 360), maxLines: Number(process.env.DOUBTS_MAX_LINES || 6) });
    // Mantém o fluxo de dúvidas ativo até o usuário solicitar Menu
    ctx.doubts = { step: "askQuestion" };
    await ctx.save();
    try { logger.info(`[Dúvidas] Fluxo permanece ativo`, { msisdn: whats, user }); } catch {}
    return concise;
  } catch (e) {
    logger.warn(`[Dúvidas] Falha ao obter resposta`, { msisdn: whats, user, msg: e?.message });
    return "Desculpe, ocorreu um erro ao processar sua dúvida.";
  }
}
