/* === D:\SmartIASystems\notification-service\src\templates\contractStatusTemplates.js === */
// Utilidades pt-BR
const yesno = b => (b ? 'sim' : 'não');
const money = v => (v==null ? null : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)));
const dt    = v => (v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(v)) : null);
const pad8  = n => (n==null ? null : (String(n).match(/^\d+$/) ? String(n).padStart(8,'0') : String(n)));
const h     = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const nonEmpty = v => v !== undefined && v !== null && String(v).trim?.() !== '';

const STAT_PT = {
  // básicos
  created:'Criado',
  updated:'Atualizado',
  deleted:'Excluído',
  cancelled:'Cancelado',
  finalized:'Finalizado',
  rejected:'Rejeitado',
  approved:'Aprovado',
  under_analysis:'Em análise',
  signed:'Assinado',
  sent_to_bank:'Enviado ao banco',

  // chaves usadas pelo contract-service
  draft:'Criado',
  bank_requirements:'Aguardando Documentação',
  submitted_to_bank:'Enviado ao banco',
  active:'Ativo',
  settled:'Quitado',

  // sinônimos comuns
  awaiting_documents:'Aguardando Documentação',
  awaiting_documentation:'Aguardando Documentação',
  awaiting_docs:'Aguardando Documentação',
  waiting_documents:'Aguardando Documentação',
};

const FINANCING_PT = v => {
  const k = String(v||'').toLowerCase();
  if (k==='sbpe') return 'SBPE';
  if (k==='mcmv'||k==='pmcmv') return 'Minha Casa Minha Vida';
  if (k==='fgts') return 'FGTS';
  return (v ?? '').toString().toUpperCase();
};
const PURPOSE_PT = v => ({purchase:'Compra',refinance:'Refinanciamento',residential:'Residencial',commercial:'Comercial',rural:'Rural'}[String(v||'').toLowerCase()] || (v ?? ''));

function inferStatusKeyFromEvent(evt){
  const e = String(evt||'').toLowerCase();
  if (!e) return null;
  if (e.endsWith('.status_changed')) return null;
  if (e.endsWith('.created')) return 'created';
  if (e.endsWith('.updated')) return 'updated';
  if (e.endsWith('.deleted')) return 'deleted';
  return null;
}
const get = (o,p)=>p.split('.').reduce((a,k)=>(a&&a[k]!==undefined)?a[k]:undefined,o);
function pick(ctx, paths){ for(const p of paths){ const v = p.includes('.')?get(ctx,p):ctx[p]; if(v!==undefined&&v!==null&&v!=='') return v; } }

function resolveIds(ctx){
  return {
    contractNumber: pick(ctx,['contractNumber','number','sequenceNumber','contract.number','contract.sequenceNumber']),
    proposalNumber: pick(ctx,['proposalNumber','proposalSeq','proposalSequenceNumber','contract.proposalNumber']),
    contractId:     pick(ctx,['contractId','id','_id','contract.id','contract._id']),
    proposalId:     pick(ctx,['proposalId'])
  };
}
function resolveParties(ctx){
  const buyers  = pick(ctx,['buyerNames','buyers','contract.buyers','buyerId','contract.buyerId']) || [];
  const sellers = pick(ctx,['sellerNames','sellers','contract.sellers','sellerId','contract.sellerId']) || [];
  const toList = a => (Array.isArray(a)?a:[a]).filter(Boolean).map(x=>x?.name ?? String(x)).join(', ');
  return { buyers: toList(buyers), sellers: toList(sellers) };
}
function resolveProducts(ctx){
  const prods = pick(ctx,['products','contract.products']) || [];
  const arr = Array.isArray(prods)?prods:[prods];
  return arr.map((p,i)=>({
    idx:i+1, code:p.productCode||p.productId||p.code||p.id||'-',
    financingType: FINANCING_PT(p.financingType),
    purpose: PURPOSE_PT(p.purpose),
    unitPrice: money(p.unitPrice),
    hasProperty: yesno(!!p.clientHasProperty),
    portability: yesno(!!p.requestPortability),
    lgpd: yesno(!!p.authorizeLGPD),
    relationship: yesno(!!p.requestBankRelationship),
    useFGTS: yesno(!!p.useFGTS),
    benefitedFGTS: yesno(!!p.clientBenefitedFGTS),
    moreBuyers: yesno(!!p.moreBuyers || !!p.coBuyer)
  }));
}
function resolveStatus(ctx){
  const inferred = inferStatusKeyFromEvent(ctx.__event || ctx.eventName);
  const toKey = String(ctx.toStatus || ctx.status || inferred || '').toLowerCase();
  const fromKey = String(ctx.fromStatus || '').toLowerCase();

  const stArr = pick(ctx,['status','contract.status']) || [];
  const st0 = Array.isArray(stArr) && stArr[0] ? stArr[0] : {};
  const deadline = pick(ctx,['statusDeadlineAt']) || st0.statusDeadlineAt;

  return {
    toPt:   ctx.statusPtBrTo   || STAT_PT[toKey]   || (ctx.toStatus || ctx.status) || 'Atualização',
    fromPt: ctx.statusPtBrFrom || STAT_PT[fromKey] || (ctx.fromStatus || ''),
    deadlineAt: dt(deadline)
  };
}
function resolveAmounts(ctx){
  const total    = pick(ctx,['amounts.total','values.total','totalValue','contractValue','value.total','valorTotal']);
  const financed = pick(ctx,['amounts.financed','values.financed','financedValue','value.financed','valorFinanciado']);
  const downPay  = pick(ctx,['amounts.downPayment','values.downPayment','downPayment','entryValue','valorEntrada','sinal']);
  return { total: money(total), financed: money(financed), downPayment: money(downPay) };
}
function resolveAuditBlock(ctx){
  const ai = (pick(ctx,['auditInformation','contract.auditInformation']) || [])[0] || {};
  const user = ctx.userName || ctx.createdByUserName || ai.createdByUserName || '-';
  const agent = ctx.agentName || ctx.contract?.agentName || ctx.contract?.agent?.name || '-';
  const realEstate = ctx.realEstateName || ctx.contract?.realEstateName || ctx.contract?.realEstate?.name || '-';
  const createdAt = dt(ctx.createdAt || ctx.contract?.createdAt || ai.createdAt) || '-';
  const updatedAt = dt(ctx.updatedAt || ctx.contract?.updatedAt || ai.updatedAt) || '-';
  const li = (k,v)=>`<li><b>${k}:</b> ${h(v)}</li>`;
  return `
    <h3 style="margin:18px 0 8px">Auditoria e criação</h3>
    <ul>
      ${li('Usuário', user)}
      ${li('Agente', agent)}
      ${li('Imobiliária', realEstate)}
      ${li('Criado em', createdAt)}
      ${li('Atualizado em', updatedAt)}
    </ul>
  `;
}
function bcCard(ctx){
  const bc = ctx.bankCorrespondent || {};
  return `
    <div style="background:#f7f9fb;border:1px solid #e6edf5;border-radius:6px;padding:14px;margin:8px 0 16px">
      <div style="font-weight:700;margin-bottom:6px">Correspondente Bancário</div>
      <div><b>Código:</b> ${h(bc.code || '-')}</div>
      <div><b>Nome:</b> ${h(bc.name || '-')}</div>
    </div>
  `;
}
function productsTable(products){
  if (!products?.length) return '';
  const rows = products.map(p=>`
    <tr>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${p.idx}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${h(p.code)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${h(p.financingType)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${h(p.purpose)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${p.unitPrice ?? '-'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.hasProperty}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.portability}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.lgpd}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.relationship}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.useFGTS}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.benefitedFGTS}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.moreBuyers}</td>
    </tr>`).join('');
  return `
    <h3 style="margin:18px 0 8px">Produtos</h3>
    <table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px">
      <thead>
        <tr style="background:#f6f6f6">
          <th style="padding:6px 8px;border:1px solid #ddd">#</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Código</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Linha</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Finalidade</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Valor do imóvel</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Imóvel próprio</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Portabilidade</th>
          <th style="padding:6px 8px;border:1px solid #ddd">LGPD</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Relacionamento</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Usa FGTS</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Já beneficiado FGTS</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Mais compradores</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}
function li(label,value){ if(!nonEmpty(value)) return ''; return `<li><b>${label}:</b> ${h(value)}</li>`; }

export function renderContractEmail(baseCtx = {}) {
  const ctx = { ...baseCtx };

  const { contractNumber, proposalNumber, /*contractId,*/ proposalId } = resolveIds(ctx);
  const { buyers, sellers } = resolveParties(ctx);
  const products = resolveProducts(ctx);
  const amounts  = resolveAmounts(ctx);
  const st       = resolveStatus(ctx);

  // Assunto: usa nº do contrato; fallback para nº da proposta
  const subjectNum = pad8(contractNumber) || pad8(proposalNumber) || 's/ nº';
  const subject = `Status do contrato #${subjectNum}: ${st.toPt}`;

  const headerBlock = `
    <p>Status alterado de <b>${h(st.fromPt || st.toPt)}</b> para <b>${h(st.toPt)}</b>.</p>
    <div style="margin:8px 0 16px">
      ${st.deadlineAt ? `<div><b>Prazo retorno:</b> ${h(st.deadlineAt)}</div>` : ''}
      <div><b>Número proposta:</b> ${h(pad8(proposalNumber) || '-')}</div>
      <div><b>Comprador(es):</b> ${h(buyers || '-')}</div>
      <div><b>Vendedor(es):</b> ${h(sellers || '-')}</div>
    </div>
  `;

  const resumoUl = [
    li('Nº contrato', pad8(contractNumber)),
    li('Nº proposta', pad8(proposalNumber)),
    li('ID proposta', proposalId),
    li('Valor total', amounts.total),
    li('Financiado', amounts.financed),
    li('Entrada', amounts.downPayment),
    li('Assinado digitalmente', yesno(!!ctx.eSigned)),
  ].filter(Boolean).join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45">
      ${bcCard(ctx)}
      ${headerBlock}
      ${resumoUl ? `<h3 style="margin:18px 0 8px">Resumo</h3><ul>${resumoUl}</ul>` : ''}
      ${productsTable(products)}
      ${resolveAuditBlock(ctx)}
    </div>
  `;

  const textLines = [
    `Status alterado de ${st.fromPt || st.toPt} para ${st.toPt}.`,
    st.deadlineAt ? `Prazo retorno: ${st.deadlineAt}` : null,
    `Número proposta: ${pad8(proposalNumber) || '-'}`,
    `Comprador(es): ${buyers || '-'}`,
    `Vendedor(es): ${sellers || '-'}`,
  ].filter(Boolean);
  const text = textLines.join('\n');

  return { subject, text, html };
}

export function renderGenericEmail(eventName, data = {}) {
  const subject = `Evento: ${eventName}`;
  const text = JSON.stringify(data, null, 2);
  const html = `<pre style="font-family:monospace;font-size:12px;white-space:pre-wrap">${h(text)}</pre>`;
  return { subject, text, html };
}

export default { renderContractEmail, renderGenericEmail };
