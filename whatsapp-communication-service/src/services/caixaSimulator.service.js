import { resilientHttp, createResilientHttpClient } from "../utils/resilientHttp.utils.js";
import logger from "../config/logger.js";
import config from "../config/config.js";
import { fetchAuthToken } from "./auth.service.js";
import SimulationRequest from "../models/simulation.model.js";
import SessionContext from "../models/sessionContext.model.js";
import { s3Client, streamToBuffer } from "./awsS3.service.js";
import { getClient, toUserJid, getSessionStatus } from "./session.service.js";
import { normalizeAnswer } from "../utils/normalizeAnswer.utils.js";
import { autocompleteHandlers } from "../utils/autocompleteRegistry.utils.js";
import { askChatGPT } from "./chatgpt.service.js";
import { formatCaixaResult } from "../utils/caixaSimulator.utils.js";
import { getOboTokenForAgent } from "./auth.service.js";
import { fetchAgentByWhatsapp } from "./identification.service.js";
import { createProposal } from "./proposal.service.js";
import mongoose from "mongoose";
import { welcomeFlow } from "../utils/welcome.utils.js";

// Normaliza BASE para evitar duplicar /v1 quando juntamos com PATHS
const RAW_BASE = (process.env.APP_CAIXA_SIMULATOR_SERVICE_URL || "https://localhost:3016").replace(/\/+$/, "");
const BASE = RAW_BASE.replace(/\/v1\/?$/, "");

const WEBHOOK = (
  process.env.APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL
  || `${(process.env.WHATSAPP_COMM_PUBLIC_URL || "https://localhost:3000").replace(/\/$/,"")}/v1/caixa/webhook`
).replace(/\/$/, "");

const PATHS = ["/v1/simulator-caixa/job", "/v1/simulator-caixa/job/"];

const tipoImovelMap = { R: "1", C: "2", Rural: "5", "1": "1", "2": "2", "5": "5" };
const finalidadeMap = {
  C: "Aquisição de Imóvel Novo",
  U: "Aquisição de Imóvel Usado",
  N: "Aquisição de Imóvel Novo",
  Reforma: "Construção/Ampliação/Reforma"
};

const truncErr = (data, n = 600) => {
  try { const s = typeof data === "string" ? data : JSON.stringify(data); return s.length > n ? s.slice(0, n) + "…" : s; }
  catch { return String(data); }
};
const toAxiosMeta = (err) => ({
  message: err?.message,
  code: err?.code,
  status: err?.response?.status,
  method: err?.config?.method?.toUpperCase?.(),
  url: `${err?.config?.baseURL || ""}${err?.config?.url || ""}`,
  reqBodySnippet: truncErr(err?.config?.data, 600),
  resDataSnippet: truncErr(err?.response?.data, 600),
  pathTried: err?.config?.url
});

const onlyDigits = v => String(v ?? '').replace(/\D/g, '');

function toCentDigits(v) {
  if (typeof v === 'number') {
    // 1234.56 -> "123456",  698700 -> "698700" (já em centavos)
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100));
  }
  const s = String(v ?? '').trim();
  if (!s) return '';
  // "1.234.567,89" -> "123456789" centavos
  if (/,/.test(s)) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? String(Math.round(n * 100)) : onlyDigits(s);
  }
  // "1234.56" -> "123456"
  if (/\.\d{1,2}$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? String(Math.round(n * 100)) : onlyDigits(s);
  }
  // só dígitos => já está em centavos
  return onlyDigits(s);
}

function birthToISO(v) {
  const s = String(v ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d,m,y] = s.split('/');
    return `${y}-${m}-${d}`; // ISO
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = onlyDigits(s);
  if (d.length === 8) return `${d.slice(4,8)}-${d.slice(2,4)}-${d.slice(0,2)}`;
  return s;
}

function mapPayload(params = {}) {
  const out = { ...params };

  // enums
  out.tipoFinanciamento = ({ R:'1', C:'2', Rural:'5' }[params.tipoFinanciamento]) ?? String(params.tipoFinanciamento ?? '');
  out.finalidade        = ({
    C: 'Aquisição de Imóvel Novo',
    U: 'Aquisição de Imóvel Usado',
    N: 'Aquisição de Imóvel Novo',
    Reforma: 'Construção/Ampliação/Reforma'
  }[params.finalidade]) ?? String(params.finalidade ?? '');

  // campos numéricos -> CENTAVOS (só dígitos)
  if ('renda'         in out) out.renda         = toCentDigits(out.renda);
  if ('valorImovel'   in out) out.valorImovel   = toCentDigits(out.valorImovel);
  if ('valorEntrada'  in out) out.valorEntrada  = toCentDigits(out.valorEntrada);
  if ('prestacaoMaxima' in out) out.prestacaoMaxima = toCentDigits(out.prestacaoMaxima);

  // documentos/telefone -> só dígitos
  if ('cpf'      in out) out.cpf      = onlyDigits(out.cpf);
  if ('telefone' in out) out.telefone = onlyDigits(out.telefone).slice(-11);

  // data -> ISO (aceita DD/MM/AAAA)
  if ('dataNascimento' in out) out.dataNascimento = birthToISO(out.dataNascimento);

  // garante callback do WhatsApp
  if (!out.callbackUrl) {
    out.callbackUrl = (
      process.env.APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL ||
      `${(process.env.WHATSAPP_COMM_PUBLIC_URL || 'https://localhost:3000').replace(/\/$/,'')}/v1/caixa/webhook`
    ).replace(/\/$/, '');
  }

  return out;
}

export async function callCaixaSimulator(params) {
  logger.info("[CaixaSimulator] Preparando chamada", { base: BASE, paths: PATHS });
  const token = await fetchAuthToken();

  const client = createResilientHttpClient({
    timeout: 120000, // 120s para processos que rodam em background
    retryDisable: true // não fazer retry: job é enfileirado e haverá callback
  });
  client.defaults.baseURL = BASE;
  client.defaults.headers["Content-Type"] = "application/json";
  client.defaults.headers.Authorization = `Bearer ${token}`;

  const payload = mapPayload(params);

  // cURL de depuração
  /*logger.debug?.("[CaixaSimulator] cURL", {
    curl: [
      `curl -k --location --request POST '${BASE}${PATHS[1]}'`,
      `--header 'Authorization: Bearer ${token}'`,
      `--header 'Content-Type: application/json'`,
      `--data '${JSON.stringify(payload)}'`
    ].join(" \\\n")
  }); */

  let lastErr;
  for (const path of PATHS) {
    try {
      const { data, status } = await client.post(path, payload);
      logger.info("[CaixaSimulator] OK", { status, path });
      // esperado: { jobId, simulationId, status }
      return data;
    } catch (err) {
      lastErr = err;
      const meta = toAxiosMeta(err);
      // Para 504/5xx, não é crítico: o job pode ter sido enfileirado. Não gerar retries.
      logger.warn("[CaixaSimulator] Falha ao enfileirar (não-crítica)", meta);
    }
  }
  // Não propaga erro: fluxo segue e callback deve chegar depois.
  return null;
}

// compat
export async function simulate(payload) { return callCaixaSimulator(payload); }

// ========= Compat layer: enqueue from simulatorQueue.service =========
// Mantém a assinatura original (collected, token) mas usa callCaixaSimulator internamente
export async function enqueueSimulator(collected /*, token */) {
  return callCaixaSimulator(collected);
}

// ================= Simulation flow (merged from simulation.service.js) =================

const CUSTOMER_CONFIG_URL = (process.env.APP_IA_CUSTOMER_CONFIGURATION_SERVICE_URL || "").replace(/\/$/,"");
const ADMIN_CONFIG_URL    = (process.env.APP_IA_ADMIN_CONFIGURATION_SERVICE_URL || "").replace(/\/$/,"");

const httpClient = createResilientHttpClient({ timeout: 8000 });

const CREDIT_RULES_LOG_MAX = Number(process.env.CREDIT_RULES_LOG_MAX || 1400);
const truncJson = (obj, n = CREDIT_RULES_LOG_MAX) => {
  try { const s = JSON.stringify(obj); return s.length > n ? s.slice(0, n) + "…" : s; }
  catch { return String(obj); }
};

function extractProposalNumber(data) {
  try {
    if (!data || typeof data !== 'object') return null;
    const candidates = ['sequenceNumber', 'sequence_number', 'proposalSequenceNumber', 'number', 'proposalNumber', 'numero', 'numeroProposta', 'proposal_no', 'proposalNo'];
    for (const k of candidates) {
      if (data[k] != null && data[k] !== '') return String(data[k]);
    }
    return null;
  } catch { return null; }
}

function formatProposalNumberText(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  const padded = digits.padStart(8, '0');
  return `*Número da Proposta: ${padded}*`;
}

function extractContactFromPayload(payload = {}) {
  const pick = (...keys) => {
    for (const k of keys) {
      if (payload[k] != null && payload[k] !== "") return payload[k];
    }
    return null;
  };

  const formatDateToISO = (dateStr) => {
    if (!dateStr) return null;
    const s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      const [, day, month, year] = match;
      return `${year}-${month}-${day}`;
    }
    const match2 = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (match2) {
      const [, day, month, year] = match2;
      return `${year}-${month}-${day}`;
    }
    return s;
  };

  const documentNumber = pick("documentNumber", "cpf", "document", "documento", "cpfNumber");
  const phoneNumber = pick("phoneNumber", "phone", "telefone", "celular", "phone_number");
  const name = pick("name", "fullName", "full_name", "nome");
  const email = pick("email", "mail");
  const birthDateRaw = pick("birthDate", "birth_date", "dataNascimento", "data_nascimento", "nascimento");
  const monthlyIncome = pick("monthlyIncome", "rendaMensal", "monthly_income", "salary", "salario", "renda");

  const contact = {};
  if (documentNumber) contact.documentNumber = String(documentNumber);
  if (phoneNumber) contact.phoneNumber = String(phoneNumber);
  if (name) contact.name = String(name);
  if (email) contact.email = String(email);
  if (birthDateRaw) {
    const formatted = formatDateToISO(birthDateRaw);
    if (formatted) contact.birthDate = formatted;
  }
  if (monthlyIncome != null && monthlyIncome !== "") contact.monthlyIncome = Number(monthlyIncome);
  return contact;
}

async function registerContactToService(contact, { whatsappPhoneNumberUser } = {}) {
  if (!contact || Object.keys(contact).length === 0) return null;

  // Normaliza a base para sempre apontar para /v1/contacts
  const rawBase = (process.env.APP_CONTACT_SERVICE_URL || "https://localhost:3006").replace(/\/$/, "");
  let baseUrl = rawBase;
  if (/\/v1\/contacts\b/.test(rawBase)) {
    baseUrl = rawBase; // já inclui /v1/contacts
  } else if (/\/v1\b/.test(rawBase)) {
    baseUrl = `${rawBase}/contacts`;
  } else if (/\/prod\b/.test(rawBase)) {
    baseUrl = `${rawBase}/v1/contacts`;
  } else {
    baseUrl = `${rawBase}/v1/contacts`;
  }
  baseUrl = baseUrl.replace(/\/$/, "");
  try {
    let token;
    let tokenType = "fallback";
    
    try {
      const agent = whatsappPhoneNumberUser ? await fetchAgentByWhatsapp(whatsappPhoneNumberUser) : null;
      const agentId = agent?.id || agent?._id;
      if (agentId) {
        token = await getOboTokenForAgent({ agentId: String(agentId), ttlSeconds: 600 });
        tokenType = "obo";
        logger.info("[SimulationService] Usando token OBO do agente", { agentId });
      } else {
        token = await fetchAuthToken();
        logger.debug?.("[SimulationService] Agente não encontrado; usando token padrão");
      }
    } catch (oboErr) {
      logger.warn("[SimulationService] Falha ao obter OBO; usando token padrão", { message: oboErr?.message });
      token = await fetchAuthToken();
    }

    const cfg = { timeout: 5000 };
    cfg.headers = { 
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    };

    if (contact.documentNumber) {
      try {
        const checkUrl = `${baseUrl}/document/${encodeURIComponent(contact.documentNumber)}`;
        const { data: existingContact } = await resilientHttp.get(checkUrl, cfg);
        
        if (existingContact && (existingContact.id || existingContact._id)) {
          logger.info("[SimulationService] Contact already exists, skipping registration", { 
            documentNumber: contact.documentNumber,
            existingId: existingContact.id || existingContact._id,
            tokenType
          });
          return { data: existingContact, status: 200, alreadyExists: true };
        }
      } catch (checkErr) {
        if (checkErr?.response?.status === 404) {
          logger.debug?.("[SimulationService] Contact not found, proceeding with POST", { 
            documentNumber: contact.documentNumber 
          });
        } else {
          logger.debug?.("[SimulationService] Contact check failed, proceeding with POST", { 
            message: checkErr?.message 
          });
        }
      }
    }

    const curlCmd = `curl -k -X POST '${baseUrl}' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${String(token).slice(0, 20)}...' \\
  -d '${JSON.stringify(contact)}'`;
    logger.debug?.("[SimulationService] Contact cURL", { curl: curlCmd, tokenType });

    try {
      const { data, status } = await resilientHttp.post(baseUrl, contact, cfg);
      logger.info("[SimulationService] Contact registered", { 
        url: baseUrl, 
        status, 
        tokenType,
        contactSnippet: truncJson(contact, 200) 
      });
      return { data, status };
    } catch (postErr) {
      const dupMsg = String(postErr?.response?.data?.error || postErr?.message || '').toLowerCase();
      const isDuplicate = postErr?.response?.status === 400 && dupMsg.includes('duplicate key');
      if (isDuplicate && contact.documentNumber) {
        logger.warn("[SimulationService] Duplicate contact detected, fetching existing", {
          documentNumber: contact.documentNumber,
          reason: postErr?.response?.data?.error || postErr?.message
        });
        try {
          const checkUrl = `${baseUrl}/document/${encodeURIComponent(contact.documentNumber)}`;
          const { data: existingContact } = await resilientHttp.get(checkUrl, cfg);
          if (existingContact && (existingContact.id || existingContact._id)) {
            return { data: existingContact, status: 200, alreadyExists: true };
          }
        } catch (recoverErr) {
          logger.debug?.("[SimulationService] Could not recover existing contact after duplicate", { message: recoverErr?.message });
        }
      }
      throw postErr;
    }
  } catch (e) {
    logger.warn("[SimulationService] Falha ao registrar contato no contact-service", {
      url: baseUrl, 
      message: e?.message, 
      status: e?.response?.status,
      responseData: e?.response?.data,
      contactSnippet: truncJson(contact, 200)
    });
    return null;
  }
}

async function registerProposalToService(collectedData, { whatsappPhoneNumberUser, buyerId } = {}) {
  try {
    if (!collectedData || Object.keys(collectedData).length === 0) return null;

    let token;
    let tokenType = "fallback";
    try {
      const agent = whatsappPhoneNumberUser ? await fetchAgentByWhatsapp(whatsappPhoneNumberUser) : null;
      const agentId = agent?.id || agent?._id;
      if (agentId) {
        token = await getOboTokenForAgent({ agentId: String(agentId), ttlSeconds: 600 });
        tokenType = "obo";
        logger.info("[SimulationService] Usando token OBO do agente (proposal)", { agentId });
      } else {
        token = await fetchAuthToken();
        logger.debug?.("[SimulationService] Agente não encontrado; usando token padrão (proposal)");
      }
    } catch (oboErr) {
      logger.warn("[SimulationService] Falha ao obter OBO; usando token padrão (proposal)", { message: oboErr?.message });
      token = await fetchAuthToken();
    }

    const payloadForProposal = { ...collectedData };
    if (buyerId) payloadForProposal.buyerId = String(buyerId);

    if (!payloadForProposal.buyerId) {
      logger.debug?.("[SimulationService] Ignorando criação de proposta: buyerId ausente");
      return null;
    }

    const proposalData = await createProposal(payloadForProposal, token);
    if (proposalData) {
      logger.info("[SimulationService] Proposta registrada", { tokenType, proposalId: proposalData.id || proposalData._id });
      return proposalData;
    }
    logger.debug?.("[SimulationService] Criação de proposta retornou nulo", { tokenType });
    return null;
  } catch (e) {
    logger.warn("[SimulationService] Falha ao registrar proposta (não bloqueante)", { message: e?.message });
    return null;
  }
}

httpClient.interceptors.request.use(async cfg => {
  const token = await fetchAuthToken();
  cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  cfg.metadata = { start: Date.now() };
  return cfg;
});
httpClient.interceptors.response.use(
  r => r,
  e => {
    const ms = Date.now() - (e?.config?.metadata?.start || Date.now());
    logger.warn("[SimulationService] HTTP falhou", {
      url: `${e?.config?.baseURL || ""}${e?.config?.url || ""}`,
      status: e?.response?.status,
      latencyMs: ms,
      dataSnippet: truncJson(e?.response?.data, 400)
    });
    return Promise.reject(e);
  }
);

async function loadAdminConfig(idAdminConfiguration) {
  const url = `${ADMIN_CONFIG_URL}/ia-admin-configurations/${idAdminConfiguration}`;
  const { data } = await httpClient.get(url);
  const questions   = Array.isArray(data?.questions) ? data.questions : [];
  const creditRules = data?.creditRules || {};
  /*logger.debug("[SimulationService] admin loaded", {
    url, questions: questions.length,
    creditRulesBytes: (()=>{ try { return JSON.stringify(creditRules).length; } catch { return -1; }})(),
    creditRulesSnippet: truncJson(creditRules)
  });*/
  return { admin: data, questions, creditRules };
}

export async function abortSimulation(whatsappPhoneNumber, whatsappPhoneNumberUser) {
  const res = await SimulationRequest.updateMany(
    { whatsappPhoneNumber, whatsappPhoneNumberUser, status: { $nin: ["COMPLETED","CANCELLED"] } },
    { $set: { status: "CANCELLED", "statusTimestamps.CANCELLED": new Date() } }
  );
  logger.info("[SimulationService] Abortadas sessões abertas", {
    whatsappPhoneNumber, whatsappPhoneNumberUser, modified: res.modifiedCount ?? res.nModified
  });
  return { cancelled: res.modifiedCount ?? res.nModified ?? 0 };
}

const isFnCall   = s => typeof s === "string" && /^\w+\(\w+\)$/.test(s);
const isAutoStep = step => !!(step?.autocomplete || step?.valueAutocomplete != null);
function findNextManualIndex(questions, start = 0) {
  let i = Math.max(0, start);
  while (i < questions.length && isAutoStep(questions[i])) i++;
  return i;
}

async function resolveAuto(step, ctx) {
  if (isFnCall(step.valueAutocomplete)) {
    const [, fnName] = step.valueAutocomplete.match(/^(\w+)\(\w+\)$/);
    const handler = autocompleteHandlers[fnName];
    if (!handler) throw new Error(`Handler "${fnName}" não encontrado`);
    const out = await handler(step, ctx);
    logger.debug?.("[SimulationService] auto(handler)", {
      simulatorParam: step.simulatorParam,
      raw: typeof out === "string" ? out.slice(0, 120) : JSON.stringify(out).slice(0, 120)
    });

    if (typeof out === "string" && /^diverg[eê]ncia/i.test(out)) {
      return { __divergencia: out };
    }
    if (step.type === "enum" && Array.isArray(step.options) && typeof out === "string") {
      if (/^sbpe\b/i.test(out))         return step.options[0];
      if (/vinculado/i.test(out))       return step.options[1];
      if (/recursos\s*fgts/i.test(out)) return step.options[2];
    }
    return out;
  }

  if (step.valueAutocomplete != null) {
    logger.debug?.("[SimulationService] auto(literal)", {
      simulatorParam: step.simulatorParam,
      raw: String(step.valueAutocomplete).slice(0, 120)
    });
    return step.valueAutocomplete;
  }

  if (step.type === "enum") {
    logger.info("[SimulationService] enum decision via regras/IA", {
      simulatorParam: step.simulatorParam,
      options: step.options,
      rulesSnippet: truncJson(ctx.rules),
      collectedKeys: Object.keys(ctx.collectedData || {})
    });

    const system = [
      "Escolha UMA opção exatamente igual a uma das listadas. Se faltar dado ou houver conflito, responda: 'Divergência: <motivo curto>'.",
      "Opções válidas:", ...(step.options || [])
    ].join("\n");
    const user = [
      "Regras de crédito:",
      typeof ctx.rules === "string" ? ctx.rules : JSON.stringify(ctx.rules || {}, null, 2),
      "Dados já coletados:",
      JSON.stringify(ctx.collectedData || {}, null, 2)
    ].join("\n");

    const answer = await askChatGPT({ messages: [{ role: "system", content: system }, { role: "user", content: user }] });
    const a = String(answer || "").trim();

    if (/^diverg[eê]ncia/i.test(a)) return { __divergencia: a };
    if (Array.isArray(step.options)) {
      if (/^sbpe\b/i.test(a))         return step.options[0];
      if (/vinculado/i.test(a))       return step.options[1];
      if (/recursos\s*fgts/i.test(a)) return step.options[2];
    }
    logger.debug?.("[SimulationService] enum decision resposta IA", { simulatorParam: step.simulatorParam, ia: a.slice(0,120) });
    return a;
  }

  return null;
}

export async function startSimulation(whatsappPhoneNumber, whatsappPhoneNumberUser) {
  logger.info(`[SimulationService] Iniciando simulação para ${whatsappPhoneNumber}`);

  let idAdminConfiguration = null;
  try {
    const ctx = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser });
    if (ctx?.status === "VERIFIED" && ctx?.idAdminConfiguration) {
      idAdminConfiguration = ctx.idAdminConfiguration;
      logger.info("[SimulationService] admin via context", { idAdminConfiguration });
    } else {
      logger.debug?.("[SimulationService] context sem admin/id ou não VERIFICADO");
    }
  } catch (e) {
    logger.warn("[SimulationService] falha ao ler context", { message: e?.message });
  }

  if (!idAdminConfiguration) {
    const custUrl = `${CUSTOMER_CONFIG_URL}/ia-customer-configurations/whatsapp/${whatsappPhoneNumber}`;
    const { data: custArr } = await httpClient.get(custUrl);
    if (!Array.isArray(custArr) || !custArr[0]) throw new Error("Cliente não configurado para simulação");
    idAdminConfiguration = custArr[0].idAdminConfiguration;
    logger.info("[SimulationService] admin via customer", { idAdminConfiguration });
  }

  const { questions, creditRules } = await loadAdminConfig(idAdminConfiguration);
  if (!questions.length) throw new Error("Perguntas de simulação não configuradas");

  let idx = 0;
  const collected = {};
  const history   = [];

  while (questions[idx] && isAutoStep(questions[idx])) {
    const step   = questions[idx];
    const rawVal = await resolveAuto(step, { rules: creditRules, collectedData: collected });

    if (rawVal && rawVal.__divergencia) {
      const msg = `${rawVal.__divergencia} Por favor, ${step.prompt || "revise os dados."}`;
      logger.info("[SimulationService] divergência pré", { simulatorParam: step.simulatorParam, msg });
      return msg;
    }
    if (typeof rawVal === "string" && /^diverg[eê]ncia/i.test(rawVal)) {
      const msg = `${rawVal} Por favor, ${step.prompt || "revise os dados."}`;
      logger.info("[SimulationService] divergência pré(str)", { simulatorParam: step.simulatorParam, msg });
      return msg;
    }

    const val = normalizeAnswer(step, rawVal ?? "");
    logger.info(`[SimulationService] (auto-pre) '${step.simulatorParam}' = ${val}`);
    collected[step.simulatorParam] = val;
    history.push({ simulatorParam: step.simulatorParam, value: val, type: "auto", timestamp: new Date() });
    idx++;
  }

  const expectedParam = questions[idx]?.simulatorParam || null;

  const session = new SimulationRequest({
    whatsappPhoneNumber,
    whatsappPhoneNumberUser,
    idAdminConfiguration,
    creditRules,
    stepIndex: idx,
    expectedParam,
    collectedData: collected,
    history,
    status: "CREATED"
  });
  await session.save();
  logger.info(`[SimulationService] Sessão criada (stepIndex=${idx}, expectedParam=${expectedParam})`);

  return questions[idx]?.prompt;
}

export async function handleSimulationAnswer(whatsappPhoneNumber, whatsappPhoneNumberUser, text) {
  
  logger.info(`[SimulationService] Processando resposta para ${whatsappPhoneNumber}`);

  const session = await SimulationRequest.findOne({
    whatsappPhoneNumber, whatsappPhoneNumberUser,
    status: { $in: ['CREATED','COLLECTING'] }
  });
  if (!session) throw new Error("Nenhuma sessão ativa. Digite 'simular financiamento' para iniciar.");

  const { questions, creditRules } = await loadAdminConfig(session.idAdminConfiguration);
  if (!questions.length) throw new Error("Perguntas de simulação não configuradas");

  let idx = session.stepIndex ?? 0;
  if (session.expectedParam) {
    const found = questions.findIndex(q => q.simulatorParam === session.expectedParam);
    if (found >= 0) idx = found;
  }
  idx = findNextManualIndex(questions, idx);

  if (idx >= questions.length) {
    const updated = await SimulationRequest.findByIdAndUpdate(
      session._id,
      { stepIndex: questions.length, expectedParam: null, status: "READY" },
      { new: true }
    );

    const payload = questions.reduce((acc, q) => {
      acc[q.simulatorParam] = (updated.collectedData || session.collectedData || {})[q.simulatorParam];
      return acc;
    }, {});

    const simulationId = session._id;  
    payload.whatsappSimulationId = session._id;
    
    let proposalSequenceNumber = null;
    let proposalId = null;
    try {
      const contact = extractContactFromPayload(payload);
      let buyerId = null;
      if (contact && Object.keys(contact).length) {
        const contactRes = await registerContactToService(contact, { whatsappPhoneNumberUser });
        buyerId = contactRes?.data?.id || contactRes?.data?._id || null;
      }
      
      if (buyerId) {
        const prop = await registerProposalToService(payload, { whatsappPhoneNumberUser, buyerId });
        proposalSequenceNumber = extractProposalNumber(prop);
        proposalId = prop?.id || prop?._id || null;
        
        if (proposalSequenceNumber || proposalId) {
          try {
            await SimulationRequest.findByIdAndUpdate(
              simulationId,
              { $set: { 
                proposalSequenceNumber,
                proposalId
              }}
            );
            logger.info('[SimulationService] Proposta salva na simulação', { 
              simulationId, 
              proposalId, 
              sequenceNumber: proposalSequenceNumber 
            });
          } catch (saveErr) {
            logger.warn('[SimulationService] Falha ao salvar proposta na simulação', { message: saveErr?.message });
          }
        }
      }
    } catch (syncErr) {
      logger.warn('[SimulationService] Erro ao criar proposta síncrona', { message: syncErr?.message });
    }
    
    if (proposalId) {
      payload.proposalId = proposalId;
    }
    
    setImmediate(async () => {
      try {
        logger.info(`[SimulationService] Iniciando job CAIXA em background com payload: ${JSON.stringify(payload).slice(0, 200)}`);
        
        const { status } = await callCaixaSimulator(payload);
        await SimulationRequest.findByIdAndUpdate(
          simulationId,
          { status: "PROCESSING" }
        );
        logger.info(`[SimulationService] Job iniciado para Simulação Caixa: ${simulationId} (status=${status})`);
      } catch (e) {
        logger.error("[SimulationService] Erro ao chamar Caixa em background", { msg: e?.message, simulationId });
      }
    });
    
    logger.info(`[SimulationService] Coleta finalizada, retornando resultado imediatamente (simulationId=${simulationId})`);
    return { 
      simulationId, 
      status: "READY", 
      collectedData: updated.collectedData || session.collectedData || {},
      proposalSequenceNumber
    };
  }

  const stepManual = questions[idx];
  let userVal;
  try { userVal = normalizeAnswer(stepManual, text); }
  catch (e) { return `${e.message} Por favor, ${stepManual.prompt}`; }

  const collected = { ...(session.collectedData || {}) };
  const history   = [];
  collected[stepManual.simulatorParam] = userVal;
  history.push({ simulatorParam: stepManual.simulatorParam, value: userVal, type: "manual", timestamp: new Date() });

  let j = idx + 1;
  while (j < questions.length && isAutoStep(questions[j])) {
    const step = questions[j];
    const raw  = await resolveAuto(step, { rules: creditRules, collectedData: collected });
    if (raw && raw.__divergencia) return `${raw.__divergencia} Por favor, ${step.prompt || "revise os dados."}`;
    const val = normalizeAnswer(step, typeof raw === "string" ? raw : (raw ?? ""));
    logger.info(`[SimulationService] (auto-pos) '${step.simulatorParam}' = ${val}`);
    collected[step.simulatorParam] = val;
    history.push({ simulatorParam: step.simulatorParam, value: val, type: "auto", timestamp: new Date() });
    j++;
  }

  const nextIdx = findNextManualIndex(questions, j);
  if (nextIdx < questions.length) {
    const nextParam = questions[nextIdx].simulatorParam || null;
    await SimulationRequest.findByIdAndUpdate(
      session._id,
      { stepIndex: nextIdx, expectedParam: nextParam, collectedData: collected, status: "COLLECTING",
        $push: { history: { $each: history } } },
      { new: true }
    );
    logger.info(`[SimulationService] Próximo prompt: index=${nextIdx}, expectedParam=${nextParam}`);
    return questions[nextIdx].prompt;
  }

  const updated = await SimulationRequest.findByIdAndUpdate(
    session._id,
    { stepIndex: questions.length, expectedParam: null, collectedData: collected, status: "READY",
      $push: { history: { $each: history } } },
    { new: true }
  );
  const payload = questions.reduce((acc, q) => { acc[q.simulatorParam] = updated.collectedData[q.simulatorParam]; return acc; }, {});
  
  const simulationId = session._id;  
  payload.whatsappSimulationId = session._id;
  
  let proposalSequenceNumber = null;
  let proposalId = null;
  try {
    const contact = extractContactFromPayload(payload);
    let buyerId = null;
    if (contact && Object.keys(contact).length) {
      const contactRes = await registerContactToService(contact, { whatsappPhoneNumberUser });
      buyerId = contactRes?.data?.id || contactRes?.data?._id || null;
    }
    
    if (buyerId) {
      const prop = await registerProposalToService(payload, { whatsappPhoneNumberUser, buyerId });
      proposalSequenceNumber = extractProposalNumber(prop);
      proposalId = prop?.id || prop?._id || null;
      
      if (proposalSequenceNumber || proposalId) {
        try {
          await SimulationRequest.findByIdAndUpdate(
            simulationId,
            { $set: { 
              proposalSequenceNumber,
              proposalId
            }}
          );
          logger.info('[SimulationService] Proposta salva na simulação', { 
            simulationId, 
            proposalId, 
            sequenceNumber: proposalSequenceNumber 
          });
        } catch (saveErr) {
          logger.warn('[SimulationService] Falha ao salvar proposta na simulação', { message: saveErr?.message });
        }
      }
    }
  } catch (syncErr) {
    logger.warn('[SimulationService] Erro ao criar proposta síncrona', { message: syncErr?.message });
  }
  
  if (proposalId) {
    payload.proposalId = proposalId;
  }
  
  setImmediate(async () => {
    try {
      logger.info(`[SimulationService] Iniciando job CAIXA em background com payload: ${JSON.stringify(payload).slice(0, 200)}`);
      
      const { status } = await callCaixaSimulator(payload);
      await SimulationRequest.findByIdAndUpdate(
        simulationId,
        { status: "PROCESSING"} 
      );
      logger.info(`[SimulationService] Job iniciado para Simulação Caixa: ${simulationId} (status=${status})`);
    } catch (e) {
      logger.error("[SimulationService] Erro ao chamar Caixa em background", { msg: e?.message, simulationId });
    }
  });

  logger.info(`[SimulationService] Coleta finalizada, retornando resultado imediatamente (simulationId=${simulationId})`);
  return { 
    simulationId, 
    status: "READY", 
    collectedData: updated.collectedData,
    proposalSequenceNumber
  };
}

export async function handleCaixaCallback(req, res, next) {
  try {
    const body = req.body || {};

    const whatsappSimulationId = body.whatsappSimulationId ?? null;
    const statusRaw       = body.status ?? body.finalStatus ?? body?.result?.status ?? "";
    const status          = String(statusRaw).toLowerCase();

    let sim = null;
    if (whatsappSimulationId) {
      const idStr = String(whatsappSimulationId);
      if (!mongoose.isValidObjectId(idStr)) {
        logger.warn("[Callback] simulationId inválido", { whatsappSimulationId: idStr });
        return res.status(400).json({ error: "Parâmetro whatsappSimulationId inválido" });
      }
      sim = await SimulationRequest.findOne({ _id: idStr });
    }
    if (!sim) {
      logger.warn("[Callback] Simulação não encontrada", { simulationId: whatsappSimulationId });
      return res.status(404).json({ error: "Simulação não encontrada" });
    }

    const merged = { ...(sim.result || {}) };
    if (body.result && typeof body.result === "object") Object.assign(merged, body.result);
    if (body.dadosOutput)  merged.dadosOutput  = body.dadosOutput;
    if (body.driveFileId)  merged.driveFileId  = body.driveFileId;
    if (whatsappSimulationId && !merged.simulationId) merged.simulationId = String(whatsappSimulationId);
    if (status) merged.status = status;

    sim.result = merged;
    sim.callbackReceivedAt = new Date();

    const ok = ["success", "completed", "ok"].includes(status);
    if (ok) await sim.updateStatus("COMPLETED");
    else {
      if (body.errorMessage) sim.errorMessage = body.errorMessage;
      await sim.updateStatus("FAILED");
    }
    await sim.save();

    let client = getClient(sim.whatsappPhoneNumber);
    if (!client) {
      try {
        await getSessionStatus(sim.whatsappPhoneNumber);
      } catch (e) {
      }

      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 4; i++) {
        client = getClient(sim.whatsappPhoneNumber);
        if (client && typeof client.sendMessage === 'function') break;
        await sleep(500);
      }
    }

    if (!client || typeof client.sendMessage !== 'function') {
      logger.warn("[Callback] Cliente WhatsApp indisponível para entrega", {
        whatsapp: sim.whatsappPhoneNumber,
        simulationId: sim.result?.simulationId
      });
      return res.sendStatus(202);
    }
    const targetJid = toUserJid(sim.whatsappPhoneNumberUser);

    let msg;
    if (merged?.dadosOutput) {
      msg = formatCaixaResult(merged.dadosOutput);
    } else {
      const systemMsg = { role: "system", content: "Formate o resultado da simulação (PT-BR), com marcadores claros; finalize com um check." };
      const userMsg   = { role: "user", content: JSON.stringify(merged, null, 2) };
      try {
        msg = await askChatGPT({ messages: [systemMsg, userMsg] });
      } catch {
        msg = ok
          ? "Sua simulação foi concluída com sucesso. ✅"
          : `Houve um erro na simulação: ${body.errorMessage || "indisponível"}`;
      }
    }

    const propNum = sim.proposalSequenceNumber || extractProposalNumber(merged);
    const headerNum = formatProposalNumberText(propNum);
    if (headerNum) {
      msg = `${headerNum}\n\n${msg}`;
    }

    try { await client.sendMessage(targetJid, { text: msg }); }
    catch (sendErr) { logger.error("[Callback] Falha ao enviar texto", { message: sendErr?.message }); }

    if (merged?.driveFileId) {
      try {
        const urlObj = new URL(merged.driveFileId);
        const key = decodeURIComponent(urlObj.pathname.slice(1));
        const bucket = process.env.AWS_S3_BUCKET || urlObj.host.split(".s3.")[0];
        const { GetObjectCommand } = await import("@aws-sdk/client-s3");
        const s3Resp = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const buffer = await streamToBuffer(s3Resp.Body);
        const contentType = s3Resp.ContentType || "application/octet-stream";
        
        let fileName = "simulacao.jpg";
        if (propNum) {
          const digits = String(propNum).replace(/\D/g, '');
          const padded = digits.padStart(8, '0');
          const ext = contentType.includes('pdf') ? 'pdf' : 'jpg';
          fileName = `${padded}.${ext}`;
        }
        
        let caption = "Relatório da sua simulação em anexo!";
        if (headerNum) {
          caption = `${headerNum}\n${caption}`;
        }
        
        await client.sendMessage(targetJid, {
          document: buffer,
          fileName,
          mimetype: contentType,
          caption
        });

        // Após enviar o relatório, retornar automaticamente ao menu inicial
        try {
          const menuMsg = await welcomeFlow({
            whatsappPhoneNumber: sim.whatsappPhoneNumber,
            user: sim.whatsappPhoneNumberUser
          });
          await client.sendMessage(targetJid, { text: menuMsg });
        } catch (menuErr) {
          logger.warn("[Callback] Falha ao enviar menu após simulação", { message: menuErr?.message });
        }
      } catch (fileErr) {
        logger.error("[Callback] Falha ao baixar/enviar arquivo do S3", { message: fileErr?.message });
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    logger.error("[Callback] Erro interno", { message: err?.message });
    return next(err);
  }
}
