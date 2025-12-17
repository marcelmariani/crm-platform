import logger from '../config/logger.js';

// Helpers de formatação
function cents(v){ return (Number(v)||0)/100; }
const brl = v => cents(v).toLocaleString('pt-BR',{ minimumFractionDigits:2 });

// Resumo simples para confirmação (originário de caixa.summary.js)
export function resumoSimulacaoConfirmacao(input = {}) {
  return `*Confirme os dados da simulação:*
• Tipo pessoa: ${input.tipoPessoa}
• Tipo financiamento: ${input.tipoFinanciamento}
• Finalidade: ${input.finalidade}
• Valor do imóvel: R$ ${brl(input.valorImovel)}
• UF/Cidade: ${input.uf} / ${input.cidade}
• CPF: ${input.cpf}
• Tel: ${input.telefone}
• Renda: R$ ${brl(input.renda)}
• Nasc.: ${input.dataNascimento}
• Entrada: R$ ${brl(input.valorEntrada)}
• Prazo: ${input.prazo} meses
• Prestação máx.: R$ ${brl(input.prestacaoMaxima)}

*Responder*: 1 = Confirmar, 2 = Editar`;
}

// Resumo padrão (originário de summary.utils.js)
export function resumoSimulacao(input = {}) {
  return `*Resumo da simulação*\n• Tipo pessoa: ${input.tipoPessoa}\n• Tipo financiamento: ${input.tipoFinanciamento}\n• Finalidade: ${input.finalidade}\n• Valor do imóvel: R$ ${brl(input.valorImovel)}\n• UF/Cidade: ${input.uf} / ${input.cidade}\n• CPF: ${input.cpf}\n• Tel: ${input.telefone}\n• Renda: R$ ${brl(input.renda)}\n• Nasc.: ${input.dataNascimento}\n• Entrada: R$ ${brl(input.valorEntrada)}\n• Prazo: ${input.prazo} meses\n• Prestação máx.: R$ ${brl(input.prestacaoMaxima)}\n\nIniciando a simulação. Avisarei quando concluir.`;
}

// Resumo humanizado (originário de summary.utils.js)
export async function resumoSimulacaoHumanizado(input = {}, proposalSequenceNumber = null) {
  try {
    const startTime = Date.now();
    const tipoFinancMap = { '1':'SBPE','2':'Vinculado','3':'Recursos FGTS' };
    const tipoPessoaMap = { 'F':'Pessoa Física','J':'Pessoa Jurídica' };
    const tipoImovelMap = { '1':'Residencial','2':'Comercial','5':'Rural' };
    const finalidadeMap = { '1':'Aquisição de Imóvel Novo','2':'Construção','3':'Reforma e/ou Ampliação','4':'Aquisição de Imóvel Usado','6':'Aquisição de Terreno','7':'Empréstimo Garantido por Imóvel','11':'Imóveis CAIXA' };
    const tipoFin = tipoFinancMap[String(input.tipoFinanciamento)] || input.tipoFinanciamento;
    const tipoPes = tipoPessoaMap[String(input.tipoPessoa)] || input.tipoPessoa;
    const tipoImovel = tipoImovelMap[String(input.tipoImovel)] || input.tipoImovel || 'Residencial';
    const finalidade = finalidadeMap[String(input.finalidade)] || input.finalidade;
    const safePrazo = (input.prazo != null && input.prazo !== '') ? `${input.prazo} meses` : '-';
    const safeEntrada = brl(input.valorEntrada);
    const safePrestacao = brl(input.prestacaoMaxima);

    const lines = [];
    if (proposalSequenceNumber) {
      const digits = String(proposalSequenceNumber).replace(/\D/g, '');
      const padded = digits.padStart(8, '0');
      lines.push(`*Número da Proposta: ${padded}*`);
      lines.push('');
    }

    lines.push(
      '👤 *Seu Perfil*',
      `Tipo: ${tipoPes}`,
      `Data Nasc.: ${input.dataNascimento || '-'}`,
      `Renda: R$ ${brl(input.renda)}/mês`,
      '',
      '💰 *Simulação de Financiamento*',
      `Tipo: ${tipoFin}`,
      `Imóvel: ${tipoImovel}`,
      `Finalidade: ${finalidade}`,
      '',
      '🏠 *Imóvel Selecionado*',
      `Localização: ${input.cidade || '-'} - ${input.uf || '-'}`,
      `Valor: R$ ${brl(input.valorImovel)}`,
      '',
      '💵 *Condições*',
      `Entrada: R$ ${safeEntrada}`,
      `Prazo: ${safePrazo}`,
      `Prestação Máx.: R$ ${safePrestacao}`,
      '',
      '✅ Iniciando simulação! Você receberá o resultado em breve.'
    );

    const resumo = lines.join('\n');
    logger.info('[Resumo] Resumo gerado', { elapsedMs: Date.now()-startTime, lines: resumo.split('\n').length });
    return resumo;
  } catch(e){
    logger.error('[Resumo] Erro ao gerar resumo', { msg:e?.message, code:e?.code });
    return resumoSimulacao(input);
  }
}

// Formatador de resultado de simulação (originário de caixaFormat.utils.js)
export function formatCaixaResult(dados = {}) {
  const linhas = [];
  if (dados.titulo) linhas.push(`*${dados.titulo}*`);
  for (const [k, v] of Object.entries(dados)) {
    if (k === 'titulo' || k === 'opcoesComparativas') continue;
    linhas.push(`• ${k}: ${v}`);
  }
  if (Array.isArray(dados.opcoesComparativas) && dados.opcoesComparativas.length) {
    linhas.push('\n*Opções comparativas:*');
    dados.opcoesComparativas.slice(0, 4).forEach((o, i) => {
      linhas.push(`${i + 1}. ${o.seguradora} — Juros Nom.: ${o['Juros Nominais']} | 1ª Prest.: ${o['1ª Prestação']}`);
    });
  }
  linhas.push('\nSimulação concluída com sucesso. ✅');
  return linhas.join('\n');
}
