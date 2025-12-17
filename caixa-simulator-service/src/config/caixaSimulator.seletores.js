// config/seletores.js
/**
 * Centraliza todos os seletores CSS usados pelo Puppeteer para interagir
 * com o simulador da Caixa. Caso o layout do site mude, basta atualizar aqui.
 */
export default {
  // URL que leva diretamente à página de simulação
  urlInicial:
    'https://www8.caixa.gov.br/siopiinternet-web/simulaOperacaoInternet.do?method=inicializarCasoUso',

  camposEtapa1: {
    tipoPessoa: (valor) => `#pessoa${valor}`,      // valor = 'F' ou 'J'
    tipoFinanciamento: '#tipoImovel',              // select do tipo de financiamento
    finalidade: '#categoriaImovel',                // select da finalidade do imóvel
    valorReforma: '#valorReforma',                 // input valor de reforma (se aplicável)
    valorImovel: '#valorImovel',                   // input valor do imóvel
    uf: '#uf',                                      // select UF
    cidade: '#cidade',                              // select Cidade (populado após escolher UF)
    imovelCidade: '#imovelCidade',                  // checkbox “imóvel na cidade”
    portabilidade: '#icPortabilidadeCreditoImobiliario', // checkbox “portabilidade”
    btnNext1: '#btn_next1'                           // botão “Próxima Etapa”
  },

  camposEtapa2: {
    cpf: '#nuCpfCnpjInteressado',                    // input CPF/CNPJ
    telefone: '#nuTelefoneCelular',                  // input Telefone Celular
    renda: '#rendaFamiliarBruta',                    // input Renda Bruta Familiar
    dataNascimento: '#dataNascimento',               // input Data de Nascimento
    autorizaLGPD: '#icArmazenamentoDadoCliente',     // checkbox LGPD
    temFGTS: '#vaContaFgtsS',                        // checkbox “Tem FGTS”
    foiBeneficiadoFGTS: '#vaFoiBeneficiadoSubsidiadoFgts', // checkbox “Foi beneficiado FGTS”
    temDependente: '#icFatorSocial',                 // checkbox Dependente
    temRelacionamentoCaixa: '#icPossuiRelacionamentoCAIXA', // checkbox Relacionamento Caixa
    btnNext2: '#btn_next2'                           // botão “Próxima Etapa” (Etapa 3 → 4)
  },

  camposEtapa3: {
  //  fornecedoraOpcao: 'a.js-form-next'               // links que escolhem a linha de crédito pelo texto
  },

  resultadoEtapa4: {
    titulo: 'h3.simulation-result-title.zeta',       // título da simulação
    containerResumo:
      'div.divDadosSimulacao.control-item.control-span-10_12.clearfix', // tabela de resumo
    containerComparativa:
      'div.control-item.control-span-10_12:not(.divDadosSimulacao)',     // tabela comparativa de valores
    tdOnclickSeguradora: 'td[onclick*="detalhaPrestacaoSeguradora"]',     // cabeçalhos financeiros
    tabelaCobertura: 'table.simple-table.tabelaSeguradora2'               // tabela de cobertura por seguradora
  }
};
