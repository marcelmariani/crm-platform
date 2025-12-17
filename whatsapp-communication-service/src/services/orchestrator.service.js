/* Orquestrador do atendimento WhatsApp */
import removeAccents from "remove-accents";
import Conversation from "../models/conversation.model.js";
import SimulationRequest from "../models/simulation.model.js";
import { startSimulation, handleSimulationAnswer, abortSimulation } from "./caixaSimulator.service.js";
import { fetchAuthToken } from "./auth.service.js";
import { askChatGPT } from "./chatgpt.service.js";
import logger from "../config/logger.js";
import config from "../config/config.js";
import { identifyAndBindByPhone } from "./identification.service.js";
import { getOrInitCtx, getAgentNameFromCtx, loadConfigsFromContextOrWhats } from "./context.service.js";
import { resumoSimulacao, resumoSimulacaoHumanizado } from "../utils/caixaSimulator.utils.js";
import { buildSystemMsgs, welcomeFlow, isRestartIntent, isMenuIntent } from "../utils/welcome.utils.js";
import { startConsultation, handleConsultationAnswer, abortConsultation } from "./proposalConsultation.service.js";
import { startDoubts, handleDoubtsAnswer, abortDoubts } from "./doubts.service.js";

/* Intenção de iniciar simulação */
const SIMULATION_TRIGGER = /\b(?:simular|simulador|simulação|simulacao)\b/i;

/* Persistência de conversas */
async function safeLog(doc) { try { await Conversation.create(doc); } catch(e){ logger.warn('[Orquestrador] Falha Conversation', e?.message || e); } }


import { enqueueSimulator } from "./caixaSimulator.service.js";

/* Propostas (criação automática ao finalizar coleta) - gerenciada no simulation.service */
// A proposta é criada no simulation.service onde temos garantia de contato criado e token OBO

/* ENTRYPOINT */
export async function handleIncomingMessage(whatsappPhoneNumber, from, text) {
  const content = typeof text === "object" ? JSON.stringify(text) : String(text || "");
  const user    = String(from || "").replace(/@.*$/, "");
  logger.info("[Orquestrador] inbound", { user, contentLen: content.length });
  await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "inbound", message: content });

  if (isMenuIntent(content) || isRestartIntent(content)) {
    try {
      await abortSimulation(whatsappPhoneNumber, user);
      await abortConsultation(whatsappPhoneNumber, user);
      await abortDoubts(whatsappPhoneNumber, user);
      const { cust, admin } = await loadConfigsFromContextOrWhats(whatsappPhoneNumber, user);
      const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
        logger.info('[Dúvidas] Reinício/Menu solicitado; fluxos abortados', { msisdn: whatsappPhoneNumber, user });
      const menuMsg = await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
      logger.info('[MenuSent] orchestrator.menuIntent', { msisdn: whatsappPhoneNumber, user, doubtsActive: false });
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: menuMsg });
      return menuMsg;
    } catch (e) {
      logger.warn("[Orquestrador] reinício falhou", { msg: e?.message });
      return "Não consegui exibir o menu agora. Tente novamente em instantes.";
    }
  }

  const ctx = await getOrInitCtx(whatsappPhoneNumber, user);

  /* Identificação + cadeia */
  if (ctx.status !== "VERIFIED") {
    const result = await identifyAndBindByPhone({ whatsappPhoneNumber, user });
    if (!result.ok) {
      const msg = result.foundAgent
        ? "Identificamos seu cadastro, porém suas *configurações administrativas* estão incompletas ou inativas. Peça ao administrador para regularizar e tente novamente."
        : "Seu número de WhatsApp ainda não está habilitado como agente. Contate o administrador para liberar o acesso.";
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: msg });
      return msg;
    }
    const { cust, admin } = await loadConfigsFromContextOrWhats(whatsappPhoneNumber, user);
    return await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName: result.agentName });
  }

  /* Fluxo normal */
  let cust, admin;
  try { ({ cust, admin } = await loadConfigsFromContextOrWhats(whatsappPhoneNumber, user)); }
  catch {
    try { return await askChatGPT({ userText: content, systemPrompt: "Você é um assistente de WhatsApp conciso e objetivo." }); }
    catch { return "Não consegui processar agora."; }
  }

  const simOpen = !!(await SimulationRequest.exists({
    whatsappPhoneNumber, whatsappPhoneNumberUser: user, status: { $nin: ["COMPLETED","CANCELLED","FAILED"] }
  }));
  
  // Verificar se há simulação concluída/cancelada/falhou após a qual o usuário interage novamente
  const lastSimulation = await SimulationRequest.findOne({
    whatsappPhoneNumber, whatsappPhoneNumberUser: user, status: { $in: ["COMPLETED","CANCELLED","FAILED"] }
  }).sort({ createdAt: -1 });
  const simulationJustEnded = lastSimulation && !simOpen; // Havia simulação, mas agora não há aberta
  
  const normalized = removeAccents(content).toLowerCase();
  const triggerMatch = SIMULATION_TRIGGER.test(content) || /\bsimulacao\b/i.test(normalized);

  // Verificar se está selecionando um serviço no menu por dígito
  let menuSelectionActive = false;
  if (/^\d$/.test(content) && !simOpen) {
      logger.info('[Dúvidas] Dígito recebido', { msisdn: whatsappPhoneNumber, user, digit: content });
    if (content === "9") {
      menuSelectionActive = true;
      const prompt = await startDoubts(whatsappPhoneNumber, user);
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
      return prompt;
    }
    const lastOutbound = await Conversation.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound" }).sort({ createdAt: -1 }).catch(() => null);
    const menuTextRaw = (lastOutbound?.message || "");
    const menuText = removeAccents(menuTextRaw).toLowerCase();
    const isMenuContext = simulationJustEnded
      || (Array.isArray(admin?.services) && (
           menuText.includes("escolha uma opcao:")
        || menuText.includes("selecione uma opcao")
        || menuText.includes("servicos")
      ));
    if (isMenuContext) {
      // Mapeamento direto para opções padrão, independente de admin.services
      if (content === "9") {
        menuSelectionActive = true;
        const prompt = await startDoubts(whatsappPhoneNumber, user);
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
        return prompt;
      }
      if (content === "2") {
        menuSelectionActive = true;
        const prompt = await startConsultation(whatsappPhoneNumber, user);
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
        return prompt;
      }
      // Deixa "1" cair para o fluxo padrão de simulação mais abaixo
    }
    if (isMenuContext && Array.isArray(admin?.services)) {
      const idx = parseInt(content, 10) - 1;
      if (idx >= 0 && idx < admin.services.length) {
        menuSelectionActive = true;
        // Se usuário escolheu opção 2 de consulta de simulação
        const chosen = String(admin.services[idx] || "");
        const chosenNorm = removeAccents(chosen).toLowerCase();
        const isConsultaOption = /consultar\s+simulacao|consultar\s+simulacao\s+financiamento|simulacao\s+imobiliario/.test(chosenNorm) || content === "2";
        if (isConsultaOption) {
          const prompt = await startConsultation(whatsappPhoneNumber, user);
          await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
          return prompt;
        }
        // Opção 9: Dúvidas Gerais sobre nossos Serviços
        const isDoubtsOption = /duvidas\s+gerais|duvida\s+geral|servicos/.test(chosenNorm) || content === "9";
        if (isDoubtsOption) {
          const prompt = await startDoubts(whatsappPhoneNumber, user);
          await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
          return prompt;
        }
      }
    }
    // Fallback quando não há admin.services: mapear opções padrão 1/2/9
    else if (isMenuContext && !Array.isArray(admin?.services)) {
      const digit = content;
      // 2 → consulta de simulação
      if (digit === "2") {
        menuSelectionActive = true;
        const prompt = await startConsultation(whatsappPhoneNumber, user);
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
        return prompt;
      }
      // 9 → dúvidas gerais
      if (digit === "9") {
        menuSelectionActive = true;
        const prompt = await startDoubts(whatsappPhoneNumber, user);
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: prompt });
        return prompt;
      }
      // 1 → simulação
      if (digit === "1") {
        menuSelectionActive = true;
        const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
        await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
        // Aviso pré-início da simulação
        const preface = "🧩 Iniciando o processo de simulação. Faremos algumas perguntas para coletar as informações necessárias.\n\nDigite *Menu* a qualquer momento para cancelar e voltar ao menu inicial.";
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: preface });
        const simulationResult = await startSimulation(whatsappPhoneNumber, user);
        if (simulationResult && typeof simulationResult === "string") {
          await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: simulationResult });
          return simulationResult;
        }
        // Se o fluxo de simulação retornar outra estrutura, apenas continuar processamento normal
        menuSelectionActive = true;
      }
    }
  }

  if (simOpen || triggerMatch || menuSelectionActive) {
    if (!simOpen && triggerMatch) {
      const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
      await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
      // Aviso pré-início da simulação
      const preface = "🧩 Iniciando o processo de simulação. Faremos algumas perguntas para coletar as informações necessárias.\n\nDigite *Menu* a qualquer momento para cancelar e voltar ao menu inicial.";
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: preface });
    }
    try {
      const simulationResult = simOpen
        ? await handleSimulationAnswer(whatsappPhoneNumber, user, content)
        : await startSimulation(whatsappPhoneNumber, user);

      // Coleta finalizada → envia RESUMO HUMANIZADO e já enfileira o simulator (sem confirmação).
      if (simulationResult && typeof simulationResult === "object" && simulationResult.collectedData) {

        // ✅ Mensagem amigável IMEDIATA após coleta final, ANTES do resumo
        const confirmationMsg = "✅ Pronto! Todas as informações foram coletadas e a simulação está sendo iniciada.";
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: confirmationMsg });
        
        // ✅ Extrair proposalSequenceNumber do resultado (criado no simulation.service)
        const proposalSequenceNumber = simulationResult.proposalSequenceNumber || null;
        if (proposalSequenceNumber) {
          logger.info('[Orchestrator] Usando número da proposta do simulation.service', { sequenceNumber: proposalSequenceNumber });
        }
        
        // ✅ Gerar resumo INSTANTANEAMENTE (template-based, não IA) com número da proposta
        const summary = await resumoSimulacaoHumanizado(simulationResult.collectedData, proposalSequenceNumber)
          .catch(e => {
            logger.warn("[Resumo] Erro ao gerar, usando padrão", { msg: e?.message });
            return resumoSimulacao(simulationResult.collectedData);
          });

        // ✅ Registrar resumo no banco
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: summary });

        // ✅ Retornar confirmação e resumo IMEDIATAMENTE ao usuário
        // Enfileirar simulador em background (não bloqueia resposta)
        setImmediate(async () => {
          try {
            // Enfileirar simulador APÓS resumo ser enviado
            const token = await fetchAuthToken();
            const resp = await enqueueSimulator(simulationResult.collectedData, token);

            // guarda correlação na sessão
            ctx.tmpSimulation = {
              ...(simulationResult.collectedData || {}),
              simulationId: resp?.simulationId 
            };
            ctx.status ||= "VERIFIED";
            await ctx.save();
            
            logger.info("[Sim] Simulação enfileirada com sucesso", { 
              simulationId: resp?.simulationId, 
              jobId: resp?.jobId,
              status: resp?.status 
            });
          } catch (e) {
            const isConnRefused = e?.code === 'ECONNREFUSED' || e?.code === 'ENOTFOUND';
            const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout');
            logger.warn("[Sim] enqueue fail (background - usuário NÃO impactado)", { 
              msg: e?.message,
              code: e?.code,
              statusCode: e?.response?.status,
              isTimeout,
              isConnRefused,
              url: e?.config?.url,
              hint: isConnRefused 
                ? 'Verifique se o serviço simulator-caixa está rodando e acessível' 
                : isTimeout 
                ? 'Simulador demorou mais que o timeout. Considere aumentar o timeout ou otimizar o serviço' 
                : 'Erro inesperado na chamada ao simulador'
            });
          }
        });

        return [confirmationMsg, summary]; // ✅ Retorna confirmação e RESUMO (duas mensagens)
      }

      if (typeof simulationResult === "string") {
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: simulationResult });
        return simulationResult;
      }
      logger.error("[Orquestrador] simulationResult inesperado", { kind: typeof simulationResult });
      return "Erro no fluxo de simulação. Digite 'simular financiamento' para reiniciar.";
    } catch (err) {
      const em = err?.message || String(err);
      if (em.includes("Nenhuma sessão ativa")) {
        const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
        return await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
      }
      return em;
    }
  }

  // Fluxo de consulta de simulação (Opção 2)
  try {
    const consultResult = await handleConsultationAnswer(whatsappPhoneNumber, user, content);
    if (consultResult) {
      if (Array.isArray(consultResult)) {
        for (const msg of consultResult) {
          await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: msg });
        }
        return consultResult;
      } else if (typeof consultResult === "string") {
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: consultResult });
        return consultResult;
      }
    }
  } catch (e) {
    logger.warn('[Orquestrador] Consulta falhou', { msg: e?.message });
  }

  // Fluxo de dúvidas gerais (Opção 9)
  try {
    const doubtsResult = await handleDoubtsAnswer(whatsappPhoneNumber, user, content);
    if (doubtsResult) {
      if (Array.isArray(doubtsResult)) {
        for (const msg of doubtsResult) {
          await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: msg });
        }
        return doubtsResult;
      } else if (typeof doubtsResult === "string") {
        await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: doubtsResult });
        return doubtsResult;
      }
    }
  } catch (e) {
    logger.warn('[Orquestrador] Dúvidas falharam', { msg: e?.message });
  }

  /* Menu por dígito - fallback para opções inválidas */
  if (/^\d$/.test(content)) {
    const lastOutbound = await Conversation.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound" }).sort({ createdAt: -1 }).catch(() => null);
    const menuText = (lastOutbound?.message || "").toLowerCase();
    const isMenuContext = menuText.includes("serviços") || simulationJustEnded;
    
    if (isMenuContext && Array.isArray(admin?.services)) {
      // Se chegou aqui, significa que o dígito era inválido
      const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
      const menuMsg = await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: menuMsg });
      return menuMsg;
    }
  }

  /* Primeira interação pós-verificação → reexibir menu */
  /* Também reexibir menu se simulação acabou de terminar */
  const historyCount = await Conversation.countDocuments({ whatsappPhoneNumber, whatsappPhoneNumberUser: user }).catch(() => 0);
  // Recarregar contexto fresco para refletir alterações feitas por outros handlers (ex.: startDoubts)
  try { ctx = await getOrInitCtx(whatsappPhoneNumber, user); } catch {}
  // Não reexibir menu se fluxo de dúvidas estiver ativo
  if (!ctx?.doubts && (historyCount <= 2 || simulationJustEnded)) {
    const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
    const menuMsg = await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
    logger.info('[MenuSent] orchestrator.firstInteraction', { msisdn: whatsappPhoneNumber, user, doubtsActive: !!ctx?.doubts });
    await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: menuMsg });
    return menuMsg;
  }

  /* Chat geral */
  // Se estamos no contexto de menu, não use ChatGPT; reexiba o menu
  try {
    const lastOutbound = await Conversation.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound" }).sort({ createdAt: -1 }).catch(() => null);
    const lastText = (lastOutbound?.message || "").toLowerCase();
    const isMenuContext = Array.isArray(admin?.services) && (lastText.includes("escolha uma opção:") || lastText.includes("selecione uma opção"));
    // Recarregar contexto fresco para refletir alterações feitas por outros handlers
    try { ctx = await getOrInitCtx(whatsappPhoneNumber, user); } catch {}
    // Não reexibir menu se fluxo de dúvidas estiver ativo
    if (!simOpen && isMenuContext && !ctx?.doubts) {
      const agentName = await getAgentNameFromCtx(whatsappPhoneNumber, user);
      const menuMsg = await welcomeFlow({ whatsappPhoneNumber, user, cust, admin, agentName });
      logger.info('[MenuSent] orchestrator.menuContext', { msisdn: whatsappPhoneNumber, user, doubtsActive: !!ctx?.doubts });
      await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: menuMsg });
      return menuMsg;
    }
  } catch {}

  const systemMsgs = buildSystemMsgs(cust, admin);
  try {
    const chatResp = await askChatGPT({ messages: [...systemMsgs, { role: "user", content }] });
    await safeLog({ whatsappPhoneNumber, whatsappPhoneNumberUser: user, direction: "outbound", message: chatResp });
    return chatResp;
  } catch {
    return "Desculpe, ocorreu um erro ao processar sua mensagem.";
  }
}

