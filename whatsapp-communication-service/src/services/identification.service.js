import { resilientHttp } from "../utils/resilientHttp.utils.js";
import logger from "../config/logger.js";
import { fetchAuthToken } from "./auth.service.js";
const trunc = (obj, n = 600) => { try { const s = typeof obj === 'string' ? obj : JSON.stringify(obj); return s.length > n ? s.slice(0,n)+"…" : s; } catch { return String(obj); } };

const ADMIN_CONFIG_URL    = (process.env.APP_IA_ADMIN_CONFIGURATION_SERVICE_URL    || "").replace(/\/$/,"");
const AGENT_RAW           = (process.env.APP_AGENT_SERVICE_URL || "").replace(/\/+$/,'');
const RE_URL              = (process.env.APP_REAL_ESTATE_SERVICE_URL || "").replace(/\/$/,"");
const BC_URL              = (process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || "").replace(/\/$/,"");
const BANK_URL            = (process.env.APP_BANK_SERVICE_URL || "").replace(/\/$/,"");

const AGENT_BASES = Array.from(new Set([
  /\/v\d+$/.test(AGENT_RAW) ? AGENT_RAW : (AGENT_RAW ? `${AGENT_RAW}/v1` : ""),
  AGENT_RAW.replace(/\/v\d+$/,'')
])).filter(Boolean);

function isActive(x){ const s = String(x?.status || x?.situacao || '').toLowerCase(); return ["ativo","active","enabled","true","1"].includes(s); }
export const onlyDigits = s => String(s||"").replace(/\D/g,'');
const toCandidates = d => { if(!d) return []; if(Array.isArray(d)) return d; if(Array.isArray(d?.items)) return d.items; if(d?.data) return Array.isArray(d.data) ? d.data : [d.data]; return [d]; };
const pickPhone = a => onlyDigits(a?.whatsapp ?? a?.whatsappPhoneNumber ?? a?.phoneNumber ?? a?.phone ?? a?.msisdn ?? a?.contact?.phone);

export async function fetchAgentByWhatsapp(msisdn){
  const phone = onlyDigits(msisdn);
  if(!phone) return null;
  if(!AGENT_BASES.length){ logger.warn('[IDENT] APP_AGENT_SERVICE_URL ausente'); return null; }
  const t = await fetchAuthToken();
  const urls = AGENT_BASES.map(b => `${b}/agents/by-phone/${phone}`);
  for (const url of urls){
    try {
      logger.debug?.('[IDENT] cURL', { curl: `curl -k '${url}' -H 'Authorization: Bearer ${t}'` });
      const start = Date.now();
      const { data, status } = await resilientHttp.get(url, { headers: { Authorization: `Bearer ${t}` } });
      logger.debug?.('[IDENT] agent lookup OK', { url, status, latencyMs: Date.now()-start, sample: trunc(Array.isArray(data)?data[0]:data) });
      const candidates = toCandidates(data);
      const agent = candidates.find(a => isActive(a) && pickPhone(a) === phone);
      if(agent) return agent;
    } catch(e){ logger.warn('[IDENT] agent falhou', { url, status:e?.response?.status, msg:e?.message }); }
  }
  return null;
}

export async function fetchAgentByWhatsappJid(jid){
  const whatsappJid = String(jid || '').trim();
  if(!whatsappJid) return null;
  if(!AGENT_BASES.length){ logger.warn('[IDENT] APP_AGENT_SERVICE_URL ausente'); return null; }
  const t = await fetchAuthToken();
  const urls = AGENT_BASES.map(b => `${b}/agents/by-whatsapp/${encodeURIComponent(whatsappJid)}`);
  for (const url of urls){
    try {
      const { data, status } = await resilientHttp.get(url, { headers: { Authorization: `Bearer ${t}` } });
      const candidates = toCandidates(data);
      const agent = candidates.find(a => isActive(a) && String(a.whatsappJid || a.jidWhatsapp || '').trim() === whatsappJid);
      if(agent) return agent;
    } catch(e){ logger.warn('[IDENT] agent jid falhou', { url, status:e?.response?.status, msg:e?.message }); }
  }
  return null;
}

// Atualiza o JID do WhatsApp do agente quando ausente
export async function updateAgentWhatsappJid(agentId, whatsappJid){
  try {
    if(!agentId || !whatsappJid) throw new Error('MissingParams');
    if(!AGENT_BASES.length){ logger.warn('[IDENT] APP_AGENT_SERVICE_URL ausente'); return false; }
    const t = await fetchAuthToken();
    const payload = { whatsappJid };
    const headers = { Authorization: `Bearer ${t}`, 'Content-Type':'application/json' };
    // Tenta PATCH e fallback para PUT
    for(const base of AGENT_BASES){
      const urlPatch = `${base}/agents/${agentId}`;
      try { await resilientHttp.patch(urlPatch, payload, { headers }); logger.info('[IDENT] whatsappJid atualizado (PATCH)', { agentId, whatsappJid }); return true; } catch(e){
        logger.warn('[IDENT] PATCH whatsappJid falhou', { url:urlPatch, status:e?.response?.status, msg:e?.message });
      }
      try { await resilientHttp.put(urlPatch, payload, { headers }); logger.info('[IDENT] whatsappJid atualizado (PUT)', { agentId, whatsappJid }); return true; } catch(e){
        logger.warn('[IDENT] PUT whatsappJid falhou', { url:urlPatch, status:e?.response?.status, msg:e?.message });
      }
    }
  } catch(err){ logger.warn('[IDENT] updateAgentWhatsappJid erro', { msg:err?.message }); }
  return false;
}

async function fetchRealEstates(ids=[]){
  if(!ids?.length || !RE_URL) return [];
  const t = await fetchAuthToken();
  const bat = `${RE_URL}/real-estates?ids=${encodeURIComponent(ids.join(','))}`;
  try { const { data } = await resilientHttp.get(bat,{ headers:{ Authorization:`Bearer ${t}` }}); const arr = Array.isArray(data)?data:(data?.items||[]); if(arr.length) return arr; } catch{}
  const out=[];
  for(const id of ids){
    const url = `${RE_URL}/real-estates/${id}`;
    try { const { data } = await resilientHttp.get(url,{ headers:{ Authorization:`Bearer ${t}` }}); if(data) out.push(data); } catch{}
  }
  return out;
}
async function fetchBankCorrespondents(ids=[]){
  if(!ids?.length || !BC_URL) return [];
  const t = await fetchAuthToken();
  const bat = `${BC_URL}/bank-correspondents?ids=${encodeURIComponent(ids.join(','))}`;
  try { const { data } = await resilientHttp.get(bat,{ headers:{ Authorization:`Bearer ${t}` }}); const arr = Array.isArray(data)?data:(data?.items||[]); if(arr.length) return arr; } catch{}
  const out=[];
  for(const id of ids){
    const url = `${BC_URL}/bank-correspondents/${id}`;
    try { const { data } = await resilientHttp.get(url,{ headers:{ Authorization:`Bearer ${t}` }}); if(data) out.push(data); } catch{}
  }
  return out;
}
async function fetchBank(bankId){
  if(!bankId) return null;
  const t = await fetchAuthToken();
  const urls = [`${BANK_URL}/banks/${bankId}`, `${BANK_URL}/v1/banks/${bankId}`].filter(Boolean);
  for(const url of urls){
    try { const { data } = await resilientHttp.get(url,{ headers:{ Authorization:`Bearer ${t}` }}); if(data && (data.id || data._id)) return data; } catch{}
  }
  return null;
}
async function fetchAdminConfigByBank(bankId){
  const t = await fetchAuthToken();
  const urls = [
    `${ADMIN_CONFIG_URL}/ia-admin-configurations?bankId=${encodeURIComponent(bankId)}`,
    `${ADMIN_CONFIG_URL}/ia-admin-configurations/bank/${encodeURIComponent(bankId)}`
  ];
  for(const url of urls){
    try { const { data } = await resilientHttp.get(url,{ headers:{ Authorization:`Bearer ${t}` }}); const item = Array.isArray(data)?data[0]:(Array.isArray(data?.items)?data.items[0]:data); if(item && (item.id || item._id)) return item; } catch{}
  }
  return null;
}

export async function identifyAndBindByPhone({ whatsappPhoneNumber, user }){
  const { default: SessionContext } = await import('../models/sessionContext.model.js');
  const msisdn = onlyDigits(user);
  logger.info('[IDENT] início', { user: msisdn });

  const agent = await fetchAgentByWhatsapp(msisdn);
  if(!agent)                return { ok:false, foundAgent:false, reason:'AGENT_NOT_FOUND' };
  if(!isActive(agent))      return { ok:false, foundAgent:true,  reason:'AGENT_INACTIVE' };

  const reList    = await fetchRealEstates(agent.realEstateIds || []);
  const reActives = reList.filter(isActive);
  if(!reActives.length)     return { ok:false, foundAgent:true,  reason:'REALESTATE_INACTIVE' };

  const bcIds     = reActives.flatMap(r => r.bankCorrespondentIds || []);
  const bcList    = await fetchBankCorrespondents(bcIds);
  const bcActives = bcList.filter(isActive);
  if(!bcActives.length)     return { ok:false, foundAgent:true,  reason:'BC_INACTIVE' };

  const bankId = bcActives.find(bc => bc.bankId)?.bankId;
  if(!bankId)               return { ok:false, foundAgent:true,  reason:'BANKID_MISSING' };

  const bank = await fetchBank(bankId);
  if(!bank || !isActive(bank)) return { ok:false, foundAgent:true, reason:'BANK_INACTIVE' };

  const admin = await fetchAdminConfigByBank(bankId);
  if(!admin)                 return { ok:false, foundAgent:true,  reason:'ADMIN_CONFIG_MISSING' };

  const agentName = agent.name || agent.fullName || agent.displayName || '';

  let ctx = await SessionContext.findOne({ whatsappPhoneNumber, whatsappPhoneNumberUser: user });
  if(!ctx) ctx = await SessionContext.create({ whatsappPhoneNumber, whatsappPhoneNumberUser:user, status:'PENDING' });

  Object.assign(ctx, {
    status: 'VERIFIED',
    agentId: agent.id || agent._id,
    agentWhatsapp: msisdn,
    welcomeSent: true,
    realEstateIds: reActives.map(r => r.id || r._id),
    bankCorrespondentIds: bcActives.map(b => b.id || b._id),
    bankId,
    idAdminConfiguration: admin.id || admin._id,
    verifiedAt: new Date(),
    lastLog: {
      agent: { id: agent.id || agent._id, whatsapp: msisdn, name: agentName },
      realEstates: reActives.map(r => r.id || r._id),
      bankCorrespondents: bcActives.map(b => b.id || b._id),
      bankId,
      idAdminConfiguration: admin.id || admin._id
    }
  });
  await ctx.save();
  return { ok:true, foundAgent:true, admin, agentName };
}

// Identificação e vínculo usando o whatsappJid completo (ex: "163672898932768@lid")
export async function identifyAndBindByJid({ whatsappJid, user }){
  const { default: SessionContext } = await import('../models/sessionContext.model.js');
  const jid = String(whatsappJid || '').trim();
  const msisdn = onlyDigits(user);
  logger.info('[IDENT] início JID', { user, whatsappJid: jid });

  if(!jid) return { ok:false, foundAgent:false, reason:'JID_MISSING' };

  const agent = await fetchAgentByWhatsappJid(jid);
  if(!agent)                return { ok:false, foundAgent:false, reason:'AGENT_NOT_FOUND' };
  if(!isActive(agent))      return { ok:false, foundAgent:true,  reason:'AGENT_INACTIVE' };

  const reList    = await fetchRealEstates(agent.realEstateIds || []);
  const reActives = reList.filter(isActive);
  if(!reActives.length)     return { ok:false, foundAgent:true,  reason:'REALESTATE_INACTIVE' };

  const bcIds     = reActives.flatMap(r => r.bankCorrespondentIds || []);
  const bcList    = await fetchBankCorrespondents(bcIds);
  const bcActives = bcList.filter(isActive);
  if(!bcActives.length)     return { ok:false, foundAgent:true,  reason:'BC_INACTIVE' };

  const bankId = bcActives.find(bc => bc.bankId)?.bankId;
  if(!bankId)               return { ok:false, foundAgent:true,  reason:'BANKID_MISSING' };

  const bank = await fetchBank(bankId);
  if(!bank || !isActive(bank)) return { ok:false, foundAgent:true, reason:'BANK_INACTIVE' };

  const admin = await fetchAdminConfigByBank(bankId);
  if(!admin)                 return { ok:false, foundAgent:true,  reason:'ADMIN_CONFIG_MISSING' };

  const agentName = agent.name || agent.fullName || agent.displayName || '';

  let ctx = await SessionContext.findOne({ whatsappJid: jid, whatsappPhoneNumber: msisdn || undefined, whatsappPhoneNumberUser: user });
  if(!ctx) ctx = await SessionContext.create({ whatsappJid: jid, whatsappPhoneNumber: msisdn || undefined, whatsappPhoneNumberUser:user, status:'PENDING' });

  Object.assign(ctx, {
    status: 'VERIFIED',
    agentId: agent.id || agent._id,
    agentWhatsappJid: jid,
    whatsappPhoneNumber: msisdn || ctx.whatsappPhoneNumber,
    whatsappPhoneNumberUser: user,
    welcomeSent: true,
    realEstateIds: reActives.map(r => r.id || r._id),
    bankCorrespondentIds: bcActives.map(b => b.id || b._id),
    bankId,
    idAdminConfiguration: admin.id || admin._id,
    verifiedAt: new Date(),
    lastLog: {
      agent: { id: agent.id || agent._id, whatsappJid: jid, name: agentName },
      realEstates: reActives.map(r => r.id || r._id),
      bankCorrespondents: bcActives.map(b => b.id || b._id),
      bankId,
      idAdminConfiguration: admin.id || admin._id
    }
  });
  await ctx.save();
  return { ok:true, foundAgent:true, admin, agentName };
}
