const pad8 = n => String(Number(n || 0)).padStart(8, '0');

const SPT = {
  created: 'Criada',
  editing: 'Em edição',
  under_analysis: 'Em análise',
  analysis_completed: 'Análise finalizada',
  approved: 'Aprovada',
  rejected: 'Reprovada',
  cancelled: 'Cancelada',
  finalized: 'Finalizada',
};
const purposePt = v => ({ purchase:'Compra', refinance:'Refinanciamento' }[String(v||'').toLowerCase()] || String(v||''));
const yesno = b => (b ? 'sim' : 'não');
const money = v => (v==null ? '-' : new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)));
const dt = v => (v ? new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'medium'}).format(new Date(v)) : '-');

function header(ctx) {
  const pn = ctx.proposalNumber || (Number.isFinite(ctx.sequenceNumber) ? pad8(ctx.sequenceNumber) : ctx.proposalId);
  const toKey = String(ctx.toStatus || ctx.status || '').toLowerCase();
  const toPt  = ctx.statusPtBrTo || SPT[toKey] || ctx.toStatus || ctx.status || '';
  return { pn, toPt, toKey };
}

export function renderProposalEmail(ctx) {
  const { pn, toPt } = header(ctx);
  const fromPt = ctx.statusPtBrFrom || SPT[String(ctx.fromStatus||'').toLowerCase()] || (ctx.fromStatus || '');

  const buyers  = (ctx.buyerNames || []).join(', ');
  const sellers = (ctx.sellerNames || []).join(', ');
  const prazo   = dt(ctx.statusDeadlineAt);

  const products = Array.isArray(ctx.productsDetailed) ? ctx.productsDetailed : (ctx.products || []);
  const rows = (products || []).map((p,i)=>`
    <tr>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:center">${i+1}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.code ?? p.productCode ?? p.productId ?? '-'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${p.name ?? p.productName ?? p.description ?? '-'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${String(p.financingType||'').toUpperCase()||'-'}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${purposePt(p.purpose)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd;text-align:right">${money(p.unitPrice)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.clientHasProperty)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.requestPortability)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.authorizeLGPD)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.requestBankRelationship)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.useFGTS)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.clientBenefitedFGTS)}</td>
      <td style="padding:6px 8px;border:1px solid #ddd">${yesno(p.moreBuyers)}</td>
    </tr>
  `).join('');

  const produtosTbl = products?.length ? `
    <h3 style="margin:18px 0 8px">Produtos</h3>
    <table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:14px">
      <thead>
        <tr style="background:#f6f6f6">
          <th style="padding:6px 8px;border:1px solid #ddd">#</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Código</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Descrição</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Tipo de financiamento</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Finalidade</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Valor do imóvel</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Imóvel próprio</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Portabilidade</th>
          <th style="padding:6px 8px;border:1px solid #ddd">LGPD</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Relacionamento bancário</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Usa FGTS</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Já beneficiado FGTS</th>
          <th style="padding:6px 8px;border:1px solid #ddd">Mais compradores</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>` : '';

  const bc = ctx.bankCorrespondent || {};
  const bcCard = `
    <div style="background:#f7f9fb;border:1px solid #e6edf5;border-radius:6px;padding:14px;margin:8px 0 16px">
      <div style="font-weight:700;margin-bottom:6px">Correspondente Bancário</div>
      <div><b>Código:</b> ${bc.code || '-'}</div>
      <div><b>Nome:</b> ${bc.name || '-'}</div>
      ${bc.address ? `<div><b>Endereço:</b> ${bc.address}</div>` : ''}
      ${(bc.contactEmail || bc.contactPhone)
        ? `<div><b>Contato:</b> ${[bc.contactEmail, bc.contactPhone].filter(Boolean).join(' • ')}</div>` : ''}
    </div>
  `;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45">
      ${bcCard}
      <p>Status alterado de <b>${fromPt || toPt}</b> para <b>${toPt}</b>.</p>
      <ul>
        <li><b>Prazo retorno:</b> ${prazo}</li>
        <li><b>Número proposta:</b> ${ctx.proposalNumber || (Number.isFinite(ctx.sequenceNumber)? pad8(ctx.sequenceNumber) : '-')}</li>
        <li><b>Comprador(es):</b> ${buyers || '-'}</li>
        <li><b>Vendedor(es):</b> ${sellers || '-'}</li>
      </ul>
      ${produtosTbl}
      <h3 style="margin:18px 0 8px">Auditoria e criação</h3>
      <ul>
        <li><b>Usuário:</b> ${ctx.userName || ctx.createdByUserName || '-'}</li>
        <li><b>Agente:</b> ${ctx.agentName || '-'}</li>
        <li><b>Imobiliária:</b> ${ctx.realEstateName || '-'}</li>
        <li><b>Correspondente bancário:</b> ${bc.name || '-'}</li>
        <li><b>Criado em:</b> ${dt(ctx.createdAt)}</li>
        <li><b>Atualizado em:</b> ${dt(ctx.updatedAt)}</li>
      </ul>
    </div>
  `;

  const text = [
    `Status alterado de ${fromPt || toPt} para ${toPt}.`,
    `Prazo retorno: ${prazo}`,
    `Número proposta: ${ctx.proposalNumber || (Number.isFinite(ctx.sequenceNumber)? pad8(ctx.sequenceNumber) : '-')}`,
    `Comprador(es): ${(buyers || '-').replace(/\s+/g,' ')}`,
    `Vendedor(es): ${(sellers || '-').replace(/\s+/g,' ')}`,
  ].join('\n');

  return { subject: `Status da proposta #${pn}: ${toPt}`, text, html };
}
