import removeAccents from "remove-accents";
import SessionContext from "../models/sessionContext.model.js";
import { createResilientHttpClient } from "../utils/resilientHttp.utils.js";
import { fetchAuthToken } from "./auth.service.js";
import logger from "../config/logger.js";

function norm(s){ return removeAccents(String(s||"").trim()).toLowerCase(); }
function onlyDigits(s){ return String(s||"").replace(/\D+/g, ""); }

async function getCtx(whats, user){
  const key = `${whats}:${user}`;
  let ctx = await SessionContext.findOne({ whatsappPhoneNumber: whats, whatsappPhoneNumberUser: user }).catch(() => null);
  if (!ctx) {
    ctx = new SessionContext({ whatsappPhoneNumber: whats, whatsappPhoneNumberUser: user, status: "VERIFIED" });
    await ctx.save();
  }
  return ctx;
}

export async function abortConsultation(whats, user){
  try {
    const ctx = await getCtx(whats, user);
    ctx.consultation = undefined;
    await ctx.save();
  } catch {}
}

export async function startConsultation(whats, user){
  const ctx = await getCtx(whats, user);
  ctx.consultation = { step: "askIdentifier" };
  await ctx.save();
  return [
    "🧭 Consulta de Simulação de Financiamento, informe:",
    "- Número da Proposta (ex.: 00001234 ou 1234)",
    "- CPF do Cliente (com ou sem pontuação)"
  ].join("\n");
}

// Query endpoints provided by sales-service
async function getProposalsByNumber(number, token, access){
  const baseSales = (process.env.APP_SALES_SERVICE_URL || "").replace(/\/$/, "");
  if (!baseSales) return [];
  const http = createResilientHttpClient();
  http.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` }; return cfg; });
  try {
    const { data } = await http.get(`${baseSales}/proposals/number/${number}`);
    const list = Array.isArray(data) ? data : (data?.items || (data ? [data] : []));
    // Filtrar por access se necessário
    if (access?.realestateId || access?.bankCorrespondentId) {
      return list.filter(p => {
        const matchRE = !access.realestateId || p?.realestateId === access.realestateId;
        const matchBC = !access.bankCorrespondentId || p?.bankCorrespondentId === access.bankCorrespondentId;
        return matchRE && matchBC;
      });
    }
    return list;
  } catch (e) {
    logger.warn('[Consult] proposals by number fail', { msg: e?.message, statusCode: e?.response?.status });
    return [];
  }
}

async function getProposalsByBuyerCpf(cpf, token, access){
  const baseSales = (process.env.APP_SALES_SERVICE_URL || "").replace(/\/$/, "");
  if (!baseSales) return [];
  const http = createResilientHttpClient();
  http.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` }; return cfg; });
  const params = { cpf };
  if (access?.realestateId) params.realestateId = access.realestateId;
  if (access?.bankCorrespondentId) params.bankCorrespondentId = access.bankCorrespondentId;
  try {
    const { data } = await http.get(`${baseSales}/proposals/by-buyer`, { params });
    const list = Array.isArray(data) ? data : (data?.items || []);
    return list;
  } catch (e) {
    logger.warn('[Consult] proposals by buyer cpf fail', { msg: e?.message });
    return [];
  }
}

async function getProposalDetail(proposalId, token, access){
  const baseSales = (process.env.APP_SALES_SERVICE_URL || "").replace(/\/$/, "");
  if (!baseSales) return null;
  const http = createResilientHttpClient();
  http.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` }; return cfg; });
  const params = {};
  if (access?.realestateId) params.realestateId = access.realestateId;
  if (access?.bankCorrespondentId) params.bankCorrespondentId = access.bankCorrespondentId;
  try {
    const { data } = await http.get(`${baseSales}/proposals/${proposalId}`, { params });
    return data || null;
  } catch (e) {
    logger.warn('[Consult] get proposal fail', { msg: e?.message });
    return null;
  }
}

export async function handleConsultationAnswer(whats, user, text){
  const ctx = await getCtx(whats, user);
  if (!ctx?.consultation) return null;
  const step = ctx.consultation.step;
  const token = await fetchAuthToken().catch(() => null);
  const access = {
    realestateId: ctx?.cust?.realestateId || ctx?.admin?.realestateId || ctx?.realestateId,
    bankCorrespondentId: ctx?.cust?.bankCorrespondentId || ctx?.admin?.bankCorrespondentId || ctx?.bankCorrespondentId
  };

  if (step === "askIdentifier") {
    const input = String(text||"").trim();
    const digits = onlyDigits(input);
    // Tenta números de proposta (4-20 dígitos)
    if (digits.length >= 4 && digits.length <= 20) {
      const proposals = await getProposalsByNumber(digits, token, access);
      if (proposals.length === 1) {
        const detail = await getProposalDetail(proposals[0]?.id || proposals[0]?._id || proposals[0]?.sequenceNumber || proposals[0]?.code, token, access);
        ctx.consultation = undefined;
        await ctx.save();
        return await enrichAndFormatProposalDetail(detail || proposals[0], token);
      }
      if (proposals.length > 1) {
        const firstProposal = proposals[0];
        const buyerCpf = firstProposal?.buyer?.cpf || firstProposal?.buyerCpf || firstProposal?.cpf || "";
        const buyerName = firstProposal?.buyer?.name || firstProposal?.buyerName || "";
        const simplified = formatProposalList(proposals, buyerCpf, buyerName);
        ctx.consultation = { step: "chooseProposal", lastList: proposals };
        await ctx.save();
        return [
          simplified,
          "\nPara detalhar, envie o Número da Proposta."
        ];
      }
      // Se não encontrou via número, tenta CPF
    }
    if (digits.length >= 11 && digits.length <= 14) {
      const proposals = await getProposalsByBuyerCpf(digits, token, access);
      if (!proposals.length) {
        ctx.consultation = { step: "askIdentifier" };
        await ctx.save();
        return "Não encontrei propostas para este CPF dentro da sua imobiliária/correspondente.";
      }
      // Extrair CPF e nome do cliente da primeira proposta
      const firstProposal = proposals[0];
      const buyerCpf = digits; // Usar o CPF que foi buscado
      const buyerName = firstProposal?.buyer?.name || firstProposal?.buyerName || "";
      const simplified = formatProposalList(proposals, buyerCpf, buyerName);
      ctx.consultation = { step: "chooseProposal", lastList: proposals };
      await ctx.save();
      return [
        simplified,
        "Para detalhar, envie o Número da Proposta."
      ];
    }
    return "Informe um Número de Proposta (ex.: 00001234) ou um CPF (somente números).";
  }

  if (step === "maybeDetail") {
    const ans = norm(text);
    if (["sim","s","yes","y"].includes(ans)) {
      const propId = ctx.consultation.proposalCandidate;
      const detail = await getProposalDetail(propId, token, access);
      if (!detail) {
        ctx.consultation = { step: "askIdentifier" };
        await ctx.save();
        return "Não consegui obter detalhes desta proposta. Tente novamente ou informe outro identificador.";
      }
      ctx.consultation = undefined;
      await ctx.save();
      return await enrichAndFormatProposalDetail(detail, token);
    } else {
      ctx.consultation = { step: "askIdentifier" };
      await ctx.save();
      return "Certo. Você pode informar outro CPF ou Número da Proposta.";
    }
  }

  if (step === "chooseProposal") {
    const input = String(text||"").trim();
    const digits = onlyDigits(input);
    if (!digits) return "Para detalhar, envie o Número da Proposta (ex.: 00001234) ou o CPF (somente números).";
    // Detalhar por Número da Proposta
    if (digits.length >= 4 && digits.length <= 20) {
      const proposals = await getProposalsByNumber(digits, token, access);
      if (proposals.length === 1) {
        const detail = await getProposalDetail(proposals[0]?.id || proposals[0]?._id || proposals[0]?.sequenceNumber || proposals[0]?.code, token, access);
        ctx.consultation = undefined;
        await ctx.save();
        return await enrichAndFormatProposalDetail(detail || proposals[0], token);
      }
      if (proposals.length > 1) {
        const firstProposal = proposals[0];
        const buyerCpf = firstProposal?.buyer?.cpf || firstProposal?.buyerCpf || firstProposal?.cpf || "";
        const buyerName = firstProposal?.buyer?.name || firstProposal?.buyerName || "";
        return [
          formatProposalList(proposals, buyerCpf, buyerName),
          "\nEnvie o Número da Proposta completo para detalhar."
        ];
      }
      return "Não encontrei propostas com este número. Tente novamente.";
    }
    // Detalhar por CPF → lista para escolha; detalhe continua por número
    if (digits.length >= 11 && digits.length <= 14) {
      const proposals = await getProposalsByBuyerCpf(digits, token, access);
      if (!proposals.length) return "Não encontrei propostas para este CPF dentro da sua imobiliária/correspondente.";
      const firstProposal = proposals[0];
      const buyerCpf = digits; // Usar o CPF que foi buscado
      const buyerName = firstProposal?.buyer?.name || firstProposal?.buyerName || "";
      return [
        formatProposalList(proposals, buyerCpf, buyerName),
        "\nPara detalhar, envie o Número da Proposta."
      ];
    }
    return "Informe um Número de Proposta válido (4–20 dígitos) ou um CPF (11 dígitos).";
  }

  return null;
}

function formatCurrencyCents(v){
  const n = typeof v === 'number' ? v : Number(v||0);
  const r = Math.round(n/100);
  return r.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function enrichAndFormatProposalDetail(p, token){
  try {
    const code = getProposalNumber(p);
    let buyerName = p?.buyer?.name || p?.buyerName || null;
    let buyerCpf  = p?.buyer?.cpf || p?.buyerCpf || p?.cpf || null;
    let buyerEmail = p?.buyer?.email || p?.buyerEmail || null;
    let buyerPhone = p?.buyer?.phone || p?.buyerPhone || null;
    const buyerId = p?.buyer?.id || p?.buyer?._id || p?.buyerId;
    
    // Buscar dados do cliente no contact-service
    if (buyerId) {
      try {
        const baseContact = (process.env.APP_CONTACT_SERVICE_URL || process.env.APP_CUSTOMER_SERVICE_URL || "").replace(/\/$/, "");
        if (baseContact) {
          const http = createResilientHttpClient();
          http.interceptors.request.use(cfg => { cfg.headers = { ...cfg.headers, Authorization: `Bearer ${token}` }; return cfg; });
          const { data } = await http.get(`${baseContact}/contacts/${buyerId}`);
          buyerName = buyerName || data?.name || data?.fullName;
          buyerCpf  = buyerCpf  || data?.cpf || data?.document;
          buyerEmail = buyerEmail || data?.email;
          buyerPhone = buyerPhone || data?.phone || data?.phoneNumber;
        }
      } catch (e) { logger.warn('[Consult] contact fetch fail', { msg: e?.message }); }
    }
    
    const cpfText = buyerCpf ? formatCpf(onlyDigits(buyerCpf)) : "(sem CPF)";
    const linhas = [];
    
    linhas.push(`📄 Proposta: ${code}`);
    linhas.push(`👤 Cliente: ${buyerName || '(sem nome)'} | CPF: ${cpfText}`);
    if (buyerPhone) linhas.push(`📱 Telefone: ${buyerPhone}`);
    
    // Status da proposta
    if (p?.status) {
      let statusValue = p.status;
      // Se for objeto, tenta extrair o campo 'status' ou 'name' ou 'label'
      if (typeof statusValue === 'object') {
        statusValue = statusValue?.status || statusValue?.name || statusValue?.label || String(statusValue);
      }
      // Se ainda for objeto, converte para string
      if (typeof statusValue === 'object') {
        statusValue = JSON.stringify(statusValue);
      }
      const statusPtBr = translateStatus(String(statusValue).trim());
      linhas.push(`📌 Status: ${statusPtBr}`);
    }
    
    // Produtos
    const produtos = Array.isArray(p?.products) ? p.products : (p?.products ? [p.products] : []);
    if (produtos.length === 0 && (p?.unitPrice || p?.amount)) {
      produtos.push(p); // fallback para proposta antiga sem array de produtos
    }
    
    produtos.forEach((prod, idx) => {
      if (produtos.length > 1) linhas.push(`\n🏷️ Produto ${idx + 1}`);
      if (prod?.description || prod?.productName) {
        linhas.push(`\n📦 ${prod.description || prod.productName}`);
      }
      
      const unitPrice = formatCurrencyCents(prod?.unitPrice || 0);
      const amount = formatCurrencyCents(prod?.amount || 0);
      const down = formatCurrencyCents(prod?.downPayment || 0);
      const purpose = translatePurpose(prod?.purpose);
      const financingType = translateFinancingType(prod?.financingType);
      
      linhas.push(`💰 Valor do Imóvel: ${unitPrice}`);
      linhas.push(`💵 Valor Financiado: ${amount}`);
      linhas.push(`💳 Entrada: ${down}`);
      linhas.push(`🏦 Linha de Crédito: ${financingType}`);
      linhas.push(`🎯 Finalidade: ${purpose}`);
      
      if (prod?.interestRate != null) {
        linhas.push(`📊 Taxa de Juros: ${prod.interestRate}% a.a.`);
      }
      if (prod?.termMonths != null) {
        linhas.push(`📅 Prazo: ${prod.termMonths} meses`);
      }
      if (prod?.gracePeriodMonths != null && prod.gracePeriodMonths > 0) {
        linhas.push(`⏳ Carência: ${prod.gracePeriodMonths} meses`);
      }
      if (prod?.monthlyPayment != null) {
        const monthly = formatCurrencyCents(prod.monthlyPayment);
        linhas.push(`💰 Parcela Mensal: ${monthly}`);
      }
    });
    
    return linhas.join("\n");
  } catch (e) {
    logger.warn('[Consult] format detail fail', { msg: e?.message });
    return "Detalhes da proposta disponíveis, mas não foi possível formatar.";
  }
}

function translatePurpose(v){
  const s = String(v || '').toLowerCase();
  const map = {
    'purchase': 'Compra de Imóvel',
    'construction': 'Construção',
    'renovation': 'Reforma',
    'land': 'Terreno',
    'loan_property_guarantee': 'Empréstimo com Garantia',
    'purchase_caixa': 'Compra (Caixa)'
  };
  return map[s] || v || '-';
}

function translateFinancingType(v){
  const s = String(v || '').toLowerCase();
  const map = {
    'sbpe': 'SBPE',
    'vinculado': 'Vinculado (FGTS)',
    'fgts': 'FGTS'
  };
  return map[s] || v || '-';
}

function translateStatus(v){
  let str = String(v || '').toLowerCase().trim();
  // Remove JSON brackets se converter para string um objeto
  if (str.startsWith('{') || str.startsWith('[')) {
    return 'Status inválido';
  }
  const map = {
    'created': 'Criada',
    'collecting': 'Em Coleta',
    'ready': 'Pronta',
    'pending': 'Pendente',
    'approved': 'Aprovada',
    'rejected': 'Rejeitada',
    'cancelled': 'Cancelada',
    'completed': 'Concluída'
  };
  return map[str] || v || '-';
}

function formatCpf(v){
  const d = onlyDigits(v);
  if (d.length !== 11) return d;
  return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
}

function formatProposalList(list, buyerCpf = null, buyerName = null){
  const header = [];
  // Mostrar cabeçalho se buyerCpf foi explicitamente fornecido (mesmo que vazio/null)
  // ou se buyerName foi fornecido
  const hasCpfParam = buyerCpf !== null && buyerCpf !== undefined;
  const hasNameParam = buyerName !== null && buyerName !== undefined;
  
  if (hasCpfParam || hasNameParam) {
    header.push("📋 Propostas encontradas para o CPF informado:");
    if (hasCpfParam && buyerCpf) header.push(`CPF: ${formatCpf(onlyDigits(buyerCpf))}`);
    if (hasNameParam && buyerName) header.push(`Cliente: ${buyerName}`);
    header.push("Propostas:");
  }
  
  const proposals = (list||[]).map(p => {
    const sequenceNum = String(p?.sequenceNumber || p?.proposalNumber || p?.number || p?.code || "0").padStart(8, "0");
    return `📄 ${sequenceNum}`;
  }).join("\n");
  
  return [
    ...header,
    proposals
  ].join("\n");
}

function getProposalNumber(p){
  return p?.proposalNumber
      || p?.sequenceNumber
      || p?.number
      || p?.code
      || p?.proposalCode
      || p?.id
      || p?._id;
}
