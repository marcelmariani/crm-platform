import fs from "fs";
import path from "path";
import qrcode from "qrcode";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from "@whiskeysockets/baileys";
import pino from "pino";
import logger from "../config/logger.js";
import { handleIncomingMessage } from "./orchestrator.service.js";
import { fetchAgentByWhatsapp } from "./identification.service.js";

/* estado */
const clients = new Map();   // msisdn -> socket
const lastQR  = new Map();   // msisdn -> { dataUrl, attempts, urlCode, updatedAt, expiresAt }
const states  = new Map();   // msisdn -> "open"|"close"|"connecting"|"unknown"
const locks   = new Set();   // criação concorrente

/* Mapeamento JID ↔ telefone */
const jidToPhone = new Map(); // JID -> telefone (string)
const phoneToJid = new Map(); // telefone -> JID (string)
const awaitingPhone = new Map(); // JID -> true (aguardando telefone do usuário)
const processedMessages = new Set(); // msg.key.id já tratado
const lastWelcomeByJid = new Map(); // JID -> Date (anti-duplicidade)
const welcomedJid = new Set(); // JIDs que já receberam welcome nesta sessão

/* paths */
// Em AWS Lambda, somente "/tmp" é gravável. Evite "/var/task".
const LAMBDA_TMP = "/tmp";
const DEFAULT_AUTH_DIR = path.join(LAMBDA_TMP, "wa-sessions");
const WA_SESSION_BASE = process.env.WA_SESSION_DIR || DEFAULT_AUTH_DIR;
ensureDir(WA_SESSION_BASE);
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function authPathFor(msisdn) {
  const p = path.join(WA_SESSION_BASE, String(msisdn));
  ensureDir(p);
  return p;
}

/* utils */
export const normalizeMsisdn = (s) => String(s || '').replace(/\D/g, '');
export function toUserJid(id) {
  const n = String(id || '').replace(/\D/g, '');
  return n.endsWith('@s.whatsapp.net') ? n : `${n}@s.whatsapp.net`;
}
export function getClient(msisdn) { return clients.get(msisdn); }

/* Extrai telefone do JID */
function extractPhoneFromJid(jid) {
  // Tenta do mapeamento persistido
  const cached = jidToPhone.get(jid);
  if (cached) return cached;
  // Somente extrai de JID padrão do WhatsApp de usuários
  if (jid.endsWith('@s.whatsapp.net')) {
    const match = jid.match(/^(\d+)@/);
    if (match && match[1]) {
      const phone = match[1];
      // Armazena no cache para próximas interações
      jidToPhone.set(jid, phone);
      phoneToJid.set(phone, jid);
      return phone;
    }
  }
  
  return null;
}
export function getLastQrDataUrl(msisdn) {
  const q = lastQR.get(msisdn);
  return q?.dataUrl ? { ...q } : null;
}
function qrStillValid(q) { return q && q.expiresAt && q.expiresAt > new Date(); }
function once(fn) { let d=false; return (...a)=>{ if(d) return; d=true; fn(...a); }; }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function listAuthFolders() {
  try {
    const entries = fs.readdirSync(WA_SESSION_BASE, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

// Define se respostas devem citar a última mensagem
function shouldQuoteReplies() {
  const v = String(process.env.REPLY_QUOTE ?? process.env.WA_REPLY_QUOTE ?? 'true').trim().toLowerCase();
  return v !== 'false';
}

// Em produção, sempre responder para o JID real; TEST_FORCE_REPLY_JID só vale em dev/test
function resolveReplyJid(jid) {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  if (env === 'test' || env === 'development') {
    return process.env.TEST_FORCE_REPLY_JID || jid;
  }
  return jid;
}

/* extrator de texto robusto */
function extractText(message) {
  const m = message || {};
  const un = (...p) => p.reduce((a,k)=>a?.[k], m);
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.audioMessage?.caption ||
    // wrappers
    m.ephemeralMessage?.message?.conversation ||
    m.ephemeralMessage?.message?.extendedTextMessage?.text ||
    m.viewOnceMessage?.message?.conversation ||
    m.viewOnceMessage?.message?.extendedTextMessage?.text ||
    m.viewOnceMessageV2Extension?.message?.conversation ||
    m.viewOnceMessageV2Extension?.message?.extendedTextMessage?.text ||
    // interativos
    m.buttonsResponseMessage?.selectedButtonId ||
    m.templateButtonReplyMessage?.selectedId ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    // fallback genérico
    un('documentMessage','caption') ||
    ""
  );
}

/* socket */
async function buildSocket(msisdn, onFirstQrResolve) {
  const { state, saveCreds } = await useMultiFileAuthState(authPathFor(msisdn));

  let version = [2, 3000, 0];
  try { ({ version } = await fetchLatestBaileysVersion()); }
  catch { logger.warn("[Sessão] Falha ao obter versão Baileys. Usando fallback [2,3000,0]"); }

  const waLogger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "warn" });
  let attempts = 0;
  const resolveFirstQr = onFirstQrResolve ? once(onFirstQrResolve) : null;

  const sock = makeWASocket({
    version,
    auth: state,
    logger: waLogger,
    printQRInTerminal: false,
    browser: ["Chrome", "Windows", "120"],
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 90_000
  });

  clients.set(msisdn, sock);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      attempts += 1;
      try {
        const dataUrl = await qrcode.toDataURL(qr, { margin: 1, scale: 6 });
        const now = new Date();
        const obj = {
          dataUrl, urlCode: qr, attempts, updatedAt: now,
          expiresAt: new Date(now.getTime() + 3 * 60 * 1000)
        };
        lastQR.set(msisdn, obj);
        resolveFirstQr?.({ qrCode: obj.dataUrl, attempts: obj.attempts, urlCode: obj.urlCode });
      } catch (e) {
        logger.warn("[Sessão] Falha ao gerar QR dataURL", e);
      }
    }

    if (connection) {
      states.set(msisdn, connection);
      logger.info(`[Sessão ${msisdn}] connection=${connection}`);
    }

    if (connection === "close") {
      const code =
        Number(lastDisconnect?.error?.output?.statusCode) ||
        Number(lastDisconnect?.error?.statusCode) ||
        Number(lastDisconnect?.error?.code);

      const isLoggedOut = code === DisconnectReason.loggedOut || code === 401;
      const needRestart = code === DisconnectReason.restartRequired || code === 408 || code === 515;

      if (isLoggedOut) {
        try { await sock?.ws?.close?.(); await sock?.end?.(); } catch {}
        clients.delete(msisdn);
        lastQR.delete(msisdn);
        states.set(msisdn, "close");
        try { await fs.promises.rm(authPathFor(msisdn), { recursive: true, force: true }); } catch {}
        logger.warn(`[Sessão ${msisdn}] loggedOut (${code}). Novo QR necessário.`);
        return;
      }

      if (needRestart) {
        try { await sock?.ws?.close?.(); await sock?.end?.(); } catch {}
        clients.delete(msisdn);
        states.set(msisdn, "connecting");
        logger.warn(`[Sessão ${msisdn}] restart (${code}). Reiniciando sem apagar credenciais.`);
        setTimeout(() => { buildSocket(msisdn).catch(err => logger.error(`[Sessão ${msisdn}] falha ao reiniciar`, err)); }, 1500);
        return;
      }

      logger.warn(`[Sessão ${msisdn}] desconectado (${code ?? 'unknown'}). Tentará reconectar.`);
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      try {
        if (!msg.message || msg.key.fromMe) continue;

        const msgId = msg?.key?.id;
        if (msgId && processedMessages.has(msgId)) {
          continue; // evita reprocessar o mesmo evento
        }

        // Suporte a JID de teste via variável de ambiente
        const forcedInboundJid = process.env.TEST_FORCE_JID;
        const jid = forcedInboundJid || (msg.key.remoteJid || "");
        
        if (jid.endsWith("@g.us")) continue;
        
        const text = extractText(msg.message).trim();
        logger.info(`[Sessão ${msisdn}] inbound ${jid} [${Object.keys(msg.message)[0]}]: "${text}"`);
        
        if (!text) continue;

        // Tenta extrair telefone do JID
        let phone = extractPhoneFromJid(jid);

        // Primeiro: tentar localizar agente diretamente pelo whatsappJid (inclui @lid)
        // Evita re-executar welcome para JIDs já acolhidos
        if (!awaitingPhone.has(jid) && !welcomedJid.has(jid)) {
          try {
            const { fetchAgentByWhatsappJid } = await import('./identification.service.js');
            const agentByJid = await fetchAgentByWhatsappJid(jid);
            if (agentByJid) {
              const replyJid = resolveReplyJid(jid);
              // Se o agente foi localizado por JID, realiza bind por JID imediatamente
              try {
                const { identifyAndBindByJid } = await import('./identification.service.js');
                const bindResult = await identifyAndBindByJid({ whatsappJid: jid, user: msisdn });
                if (!bindResult.ok) {
                  const failMsg = "Cadastro encontrado, porém com restrições.\n\n" +
                    "Suas configurações administrativas estão incompletas ou inativas.\n" +
                    "Solicite ao administrador a regularização e tente novamente.";
                  await sock.sendMessage(replyJid, { text: failMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
                  logger.warn(`[Sessão ${msisdn}] Bind por JID falhou: ${bindResult.reason}`);
                  // Evita duplicidade de mensagens no mesmo upsert
                  awaitingPhone.delete(jid);
                  if (msgId) processedMessages.add(msgId);
                  continue;
                } else {
                  // Atualiza mapeamento auxiliar se houver telefone disponível no cadastro
                  const msisdnCandidate = normalizeMsisdn(agentByJid.phoneNumber || agentByJid.whatsappPhoneNumber || '');
                  if (msisdnCandidate) {
                    jidToPhone.set(jid, msisdnCandidate);
                    phoneToJid.set(msisdnCandidate, jid);
                    phone = msisdnCandidate;
                  }
                  // Anti-duplicidade: se já foi enviado welcome há < 5s, pula
                  const last = lastWelcomeByJid.get(jid);
                  if (last && (Date.now() - last.getTime()) < 5000) {
                    logger.warn(`[Sessão ${msisdn}] Welcome por JID suprimido (duplo <5s)`);
                    if (msgId) processedMessages.add(msgId);
                    awaitingPhone.delete(jid);
                    continue;
                  }
                  // Envia boas-vindas (se ainda não foi enviada nesta sessão persistida)
                  try {
                    const { default: SessionContext } = await import('../models/sessionContext.model.js');
                    // Preferir contexto por phone (whatsappPhoneNumberUser) se disponível, pois dúvidas são salvas por (msisdn + user)
                    const ctxByUser = phone
                      ? await SessionContext.findOne({ whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: phone })
                      : null;
                    const existingCtx = ctxByUser
                      || await SessionContext.findOne({ whatsappJid: jid, whatsappPhoneNumber: msisdn });
                    if (existingCtx?.welcomeSent || existingCtx?.doubts) {
                      // Importante: NÃO interromper o processamento da mensagem.
                      // Aqui só suprimimos o reenvio do menu; a mensagem atual (ex: "1")
                      // precisa cair no orquestrador para iniciar a simulação.
                      logger.info(`[Sessão ${msisdn}] Welcome já enviado ou fluxo de dúvidas ativo; suprimindo reenvio e seguindo.`);
                      welcomedJid.add(jid);
                      lastWelcomeByJid.set(jid, new Date());
                      awaitingPhone.delete(jid);
                      // Não marcar msgId como processado aqui; deixe seguir para o orquestrador.
                    } else {
                    const { loadConfigsFromContextOrWhats } = await import('./context.service.js');
                    const { welcomeFlow } = await import('../utils/welcome.utils.js');
                    const { cust, admin } = await loadConfigsFromContextOrWhats(msisdn, phone || null);
                    // Não enviar menu se fluxo de dúvidas estiver ativo
                    // Rechecar usando chave (msisdn + user) quando possível
                    let doubtsActive = existingCtx?.doubts;
                    try {
                      if (!doubtsActive && phone) {
                        const { default: SessionContext } = await import('../models/sessionContext.model.js');
                        const recheck = await SessionContext.findOne({ whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: phone });
                        doubtsActive = !!recheck?.doubts;
                      }
                    } catch {}
                    if (doubtsActive) {
                      logger.info(`[Sessão ${msisdn}] Fluxo de dúvidas ativo; suprimindo welcomeFlow após bind por JID.`);
                    } else {
                      const welcomeMsg = await welcomeFlow({ whatsappPhoneNumber: msisdn, user: phone || jid, cust, admin, agentName: bindResult.agentName });
                      logger.info('[MenuSent] session.bindJid', { msisdn: msisdn, user: (phone || jid), doubtsActive: false });
                      await sock.sendMessage(replyJid, { text: welcomeMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
                    }
                    try { await SessionContext.updateOne({ whatsappJid: jid, whatsappPhoneNumber: msisdn }, { $set: { welcomeSent: true } }); } catch {}
                    logger.info(`[Sessão ${msisdn}] Bind por JID OK e menu enviado para ${bindResult.agentName || phone || jid}`);
                    lastWelcomeByJid.set(jid, new Date());
                    welcomedJid.add(jid);
                    // Limpa força de JID de teste após primeira acolhida
                    try { if (process.env.TEST_FORCE_JID) delete process.env.TEST_FORCE_JID; } catch {}
                    // Evita seguir processamento normal para esta mesma mensagem
                    awaitingPhone.delete(jid);
                    if (msgId) processedMessages.add(msgId);
                    continue;
                    }
                  } catch(e){
                    const fallbackWelcome = null; // suprimido: nunca enviar menu alternativo
                    try {
                      const { default: SessionContext } = await import('../models/sessionContext.model.js');
                      let doubtsActive2 = false;
                      if (phone) {
                        const byUser2 = await SessionContext.findOne({ whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: phone });
                        doubtsActive2 = !!byUser2?.doubts;
                      } else {
                        const existingCtx2 = await SessionContext.findOne({ whatsappJid: jid, whatsappPhoneNumber: msisdn });
                        doubtsActive2 = !!existingCtx2?.doubts;
                      }
                      logger.info(`[Sessão ${msisdn}] Fluxo de dúvidas ativo; fallback welcome suprimido.`);
                    } catch { /* suprimido */ }
                    logger.warn(`[Sessão ${msisdn}] Falha ao montar menu via welcomeFlow; fallback suprimido`, { msg: e?.message });
                    awaitingPhone.delete(jid);
                    lastWelcomeByJid.set(jid, new Date());
                    welcomedJid.add(jid);
                    try { if (process.env.TEST_FORCE_JID) delete process.env.TEST_FORCE_JID; } catch {}
                    if (msgId) processedMessages.add(msgId);
                    continue;
                  }
                }
              } catch(e){ logger.warn('[Sessão] Bind por whatsappJid falhou', { msg:e?.message }); }
              logger.info(`[Sessão ${msisdn}] Agente localizado por whatsappJid`, { agentId: agentByJid.id || agentByJid._id });
            }
          } catch(e){ logger.warn('[Sessão] Lookup por whatsappJid falhou', { msg:e?.message }); }
        }
        
        // Se temos telefone derivado do JID, tentar localizar o agente imediatamente
        if (phone && !awaitingPhone.has(jid)) {
          try {
            const agentTry = await fetchAgentByWhatsapp(phone);
            const replyJid = resolveReplyJid(jid);
            if (agentTry) {
              // Atualiza mapeamento e persiste JID no agente se estiver ausente
              jidToPhone.set(jid, phone);
              phoneToJid.set(phone, jid);
              try {
                const { updateAgentWhatsappJid } = await import('./identification.service.js');
                const agentId = agentTry.id || agentTry._id;
                if (agentId && !agentTry.whatsappJid) {
                  const ok = await updateAgentWhatsappJid(agentId, jid);
                  logger.info(`[Sessão ${msisdn}] whatsappJid ${ok ? 'atualizado' : 'não atualizado'} (pré-prompt)`, { agentId, jid });
                }
              } catch(e){ logger.warn('[Sessão] Falha ao atualizar whatsappJid (pré-prompt)', { msg:e?.message }); }
              // segue fluxo normal; orquestrador fará bind/boas-vindas depois
            } else {
              // Agent não localizado pelo telefone derivado → solicitar telefone
              awaitingPhone.set(jid, true);
              const askPhoneMsg = "👋 Vamos validar seu acesso.\n\n" +
                "Não achei seu cadastro automático. Me envie seu *telefone* (apenas números, com DDD).\n\n" +
                "_Exemplo: 011999887766_";
              await sock.sendMessage(replyJid, { text: askPhoneMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
              logger.info(`[Sessão ${msisdn}] Solicitação de telefone após falha por JID (${jid})`);
              continue;
            }
          } catch(e){ logger.warn('[Sessão] Erro ao tentar localizar por JID->telefone', { msg:e?.message }); }
        }
        
        // Se não conseguiu extrair/derivar telefone nem localizar por JID, solicitar telefone
        if (!phone && !awaitingPhone.has(jid)) {
          logger.warn(`[Sessão ${msisdn}] Não foi possível validar seu cadastro pelo identificador atual (${jid}).`);
          awaitingPhone.set(jid, true);
          const askPhoneMsg = "👋 Vamos validar seu acesso.\n\n" +
            "Não foi possível localizar seu cadastro automaticamente.\n" +
            "Informe seu número de telefone (apenas números, com DDD).\n\n" +
            "Exemplo: 011999887766";
          const replyJid = resolveReplyJid(jid);
          await sock.sendMessage(replyJid, { text: askPhoneMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
          logger.info(`[Sessão ${msisdn}] Solicitado telefone para ${jid} (responderá em ${replyJid})`);
          continue;
        }
        
        // Se está aguardando telefone, processa a resposta
        if (!phone && awaitingPhone.has(jid)) {
          const userPhone = text.replace(/\D/g, '');
          
          // Valida formato do telefone (mínimo 10 dígitos: DDD + 8/9 dígitos)
          if (userPhone.length < 10 || userPhone.length > 13) {
            const errorMsg = "Número inválido.\n\n" +
              "Informe um número válido com DDD (apenas números).\n\n" +
              "Exemplo: 011999887766";
            await sock.sendMessage(jid, { text: errorMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
            logger.warn(`[Sessão ${msisdn}] Telefone inválido informado: ${userPhone}`);
            continue;
          }
          
          logger.info(`[Sessão ${msisdn}] Telefone informado: ${userPhone}. Iniciando validação de cadastro...`);
          // Mensagem amigável de processamento/validação
          try {
            const processingMsg = "🔎 Validando seu cadastro...\n\n" +
              "Estou conferindo suas permissões e configurações. Em instantes retorno com a confirmação.";
            const replyJidProcessing = process.env.TEST_FORCE_REPLY_JID || jid;
            await sock.sendMessage(replyJidProcessing, { text: processingMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
          } catch {}
          
          logger.info(`[Sessão ${msisdn}] Mensagem de validação enviada. Buscando agente...`);

          // Busca agente pelo telefone
          const agent = await fetchAgentByWhatsapp(userPhone);
          const replyJid = process.env.TEST_FORCE_REPLY_JID || jid;

          if (!agent) {
            awaitingPhone.delete(jid);
            const accessDeniedMsg = "Acesso não autorizado.\n\n" +
              "Não foi possível localizar seu cadastro como agente.\n" +
              "Entre em contato com o administrador para solicitar a liberação.";
            await sock.sendMessage(replyJid, { text: accessDeniedMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
            logger.warn(`[Sessão ${msisdn}] Agente não encontrado para telefone ${userPhone}`);
            continue;
          }

          // Atualiza mapeamento em memória
          jidToPhone.set(jid, userPhone);
          phoneToJid.set(userPhone, jid);
          awaitingPhone.delete(jid);
          phone = userPhone;

          logger.info(`[Sessão ${msisdn}] Agente encontrado. Iniciando vinculação de contexto.`);

          // Atualiza jidWhatsapp no cadastro do agente se estiver ausente
          try {
            const { updateAgentWhatsappJid } = await import('./identification.service.js');
            const agentId = agent.id || agent._id;
            if (agentId && !agent.whatsappJid) {
              const ok = await updateAgentWhatsappJid(agentId, jid);
              logger.info(`[Sessão ${msisdn}] whatsappJid ${ok ? 'atualizado' : 'não atualizado'}`, { agentId, jid });
            }
          } catch(e){ logger.warn('[Sessão] Falha ao atualizar jidWhatsapp do agente', { msg:e?.message }); }

          // Vincula contexto persistente e cadeia administrativa
          try {
            const { identifyAndBindByPhone } = await import('./identification.service.js');
            const bindResult = await identifyAndBindByPhone({ whatsappPhoneNumber: msisdn, user: userPhone });
            if (!bindResult.ok) {
              const failMsg = "Cadastro encontrado, porém com restrições.\n\n" +
                "Suas configurações administrativas estão incompletas ou inativas.\n" +
                "Solicite ao administrador a regularização e tente novamente.";
              await sock.sendMessage(replyJid, { text: failMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
              logger.warn(`[Sessão ${msisdn}] Bind falhou: ${bindResult.reason}`);
              continue;
            }

            // Boas-vindas com menu oficial (welcomeFlow), incluindo emojis e nome em negrito
            try {
              const { loadConfigsFromContextOrWhats } = await import('./context.service.js');
              const { welcomeFlow } = await import('../utils/welcome.utils.js');
              const { cust, admin } = await loadConfigsFromContextOrWhats(msisdn, userPhone);
              // Não enviar menu se fluxo de dúvidas estiver ativo
              try {
                const { default: SessionContext } = await import('../models/sessionContext.model.js');
                const ctxCheck = await SessionContext.findOne({ whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: userPhone });
                if (ctxCheck?.doubts) {
                  logger.info(`[Sessão ${msisdn}] Fluxo de dúvidas ativo; suprimindo welcomeFlow após bind por telefone.`);
                } else {
                  const welcomeMsg = await welcomeFlow({ whatsappPhoneNumber: msisdn, user: userPhone, cust, admin, agentName: bindResult.agentName });
                  logger.info('[MenuSent] session.bindPhone', { msisdn: msisdn, user: userPhone, doubtsActive: false });
                  await sock.sendMessage(replyJid, { text: welcomeMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
                }
              } catch {
                const welcomeMsg = await welcomeFlow({ whatsappPhoneNumber: msisdn, user: userPhone, cust, admin, agentName: bindResult.agentName });
                await sock.sendMessage(replyJid, { text: welcomeMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
              }
              // Persistir associação do JID e marcar welcome enviado para evitar reenvio quando o inbound vier como @lid
              try {
                const { default: SessionContext } = await import('../models/sessionContext.model.js');
                await SessionContext.updateOne(
                  { whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: userPhone },
                  { $set: { whatsappJid: jid, welcomeSent: true } },
                  { upsert: true }
                );
              } catch(e){ logger.warn('[Sessão] Falha ao persistir JID/welcomeSent no bind telefônico', { msg:e?.message }); }
              logger.info(`[Sessão ${msisdn}] Bind OK e menu enviado para ${bindResult.agentName || userPhone}`);
            } catch(e){
              const fallbackWelcome = null; // suprimido: nunca enviar menu alternativo
              try {
                const { default: SessionContext } = await import('../models/sessionContext.model.js');
                const ctxCheck2 = await SessionContext.findOne({ whatsappPhoneNumber: msisdn, whatsappPhoneNumberUser: userPhone });
                logger.info(`[Sessão ${msisdn}] Fluxo de dúvidas ativo; fallback welcome suprimido.`);
              } catch { /* suprimido */ }
              logger.warn(`[Sessão ${msisdn}] Falha ao montar menu via welcomeFlow; fallback suprimido`, { msg: e?.message });
            }
            // Evita seguir para o orquestrador na mesma mensagem (telefone informado)
            continue;
          } catch (e) {
            const errMsg = "Ocorreu um erro ao confirmar seu acesso. Tente novamente em instantes.";
            await sock.sendMessage(replyJid, { text: errMsg }, shouldQuoteReplies() ? { quoted: msg } : {});
            logger.error(`[Sessão ${msisdn}] Erro no bind`, e);
            continue;
          }
          
          // Continua para processar normalmente (orchestrator fará bind completo)
        }
        
        // Fluxo normal: processa mensagem
        const reply = await handleIncomingMessage(msisdn, phone || jid, text);
        if (reply) {
          const replyJid = process.env.TEST_FORCE_REPLY_JID || jid;
          const quoted = shouldQuoteReplies();
          const sendList = Array.isArray(reply) ? reply : [reply];
          for (const r of sendList) {
            await sock.sendMessage(replyJid, { text: r }, quoted ? { quoted: msg } : {});
            logger.info(`[Sessão ${msisdn}] reply -> ${replyJid} ${quoted ? '(quoted)' : '(plain)'} ${Array.isArray(reply) ? '(multi)' : ''}`);
          }
        }
        if (msgId) processedMessages.add(msgId);
      } catch (err) {
        logger.error("[Sessão] Erro no handler de mensagem", err);
      }
    }
  });

  return sock;
}

function waitForNextQr(msisdn, timeoutMs = 30000) {
  const sock = clients.get(msisdn);
  if (!sock) return Promise.reject(new Error("NO_CLIENT"));
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { cleanup(); reject(new Error("QR_TIMEOUT")); }, timeoutMs);
    const handler = () => {
      const q = lastQR.get(msisdn);
      if (q) { cleanup(); resolve({ qrCode: q.dataUrl, attempts: q.attempts, urlCode: q.urlCode }); }
    };
    const cleanup = () => { clearTimeout(to); sock.ev.off("connection.update", handler); };
    sock.ev.on("connection.update", handler);
  });
}

/* API */
export async function createSessionService(msisdn) {
  logger.info(`[Sessão] Iniciando sessão ${msisdn}`);

  if (clients.has(msisdn)) {
    const q = lastQR.get(msisdn);
    if (qrStillValid(q)) return { qrCode: q.dataUrl, attempts: q.attempts, urlCode: q.urlCode };

    const st = states.get(msisdn);
    if (st === "connecting") {
      try { return await waitForNextQr(msisdn, 30000); } catch {}
    }
    if (st === "open") return { status: "already_connected" };
  }

  if (locks.has(msisdn)) {
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      const q = lastQR.get(msisdn);
      if (qrStillValid(q)) return { qrCode: q.dataUrl, attempts: q.attempts, urlCode: q.urlCode };
    }
    return { status: "busy" };
  }

  locks.add(msisdn);
  try {
    let resolver;
    const firstQr = new Promise((r) => (resolver = r));
    await buildSocket(msisdn, resolver);
    return await firstQr;
  } finally {
    locks.delete(msisdn);
  }
}

export async function deleteSessionService(msisdn) {
  if (!msisdn) {
    const all = Array.from(new Set([...clients.keys(), ...listAuthFolders()]));
    let n = 0;
    for (const m of all) n += (await deleteSessionService(m)).deleted ? 1 : 0;
    return { deletedAll: n };
  }

  logger.info(`[Sessão] Deletando sessão ${msisdn}`);
  const sock = clients.get(msisdn);
  try { await sock?.ws?.close?.(); await sock?.end?.(); await sock?.logout?.(); } catch {}
  clients.delete(msisdn);
  lastQR.delete(msisdn);
  states.delete(msisdn);
  try { await fs.promises.rm(authPathFor(msisdn), { recursive: true, force: true }); } catch {}
  return { deleted: 1, msisdn };
}

export async function loadExistingSessions() {
  const sessions = listAuthFolders();
  for (const phone of sessions) {
    try { await buildSocket(phone); } catch (err) { logger.error(`[Sessão] Falha ao restaurar ${phone}`, err); }
  }
  logger.info(`[Sessão] Sessões existentes carregadas: ${sessions.length}`);
}

export async function getSessionStatus(msisdn) {
  let sock = clients.get(msisdn);

  if (!sock && listAuthFolders().includes(String(msisdn)) && !locks.has(msisdn)) {
    try {
      states.set(msisdn, "connecting");
      await buildSocket(msisdn);
      sock = clients.get(msisdn);
    } catch (e) {
      logger.warn(`[Sessão ${msisdn}] auto-load falhou`, e);
    }
  }

  if (!sock) return { exists: false, state: "NO_CLIENT" };

  const conn = (states.get(msisdn) || "unknown").toUpperCase();
  const state = conn === "OPEN" ? "CONNECTED" : conn;
  const qr = getLastQrDataUrl(msisdn);
  return { exists: true, state, qrAvailable: !!qr };
}
