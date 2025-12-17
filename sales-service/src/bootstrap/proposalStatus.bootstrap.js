import ProposalStatus from '../models/proposalStatus.js';
import logger from '../config/logger.js';

const SYSTEM = [
  { key: 'created', descriptionPtBr: 'Criada', objectivePtBr: 'Proposta criada', sortOrder: 10 },
  { key: 'editing', descriptionPtBr: 'Em edição', objectivePtBr: 'Proposta em alteração', sortOrder: 15 }, 
  { key: 'under_analysis', descriptionPtBr: 'Em análise', objectivePtBr: 'Simulação em execução', sortOrder: 20 },
  { key: 'analysis_completed', descriptionPtBr: 'Análise finalizada', objectivePtBr: 'Simulação concluída', sortOrder: 30 },
  { key: 'cancelled', descriptionPtBr: 'Cancelada', objectivePtBr: 'Proposta cancelada', sortOrder: 990 },
  { key: 'finalized', descriptionPtBr: 'Finalizada', objectivePtBr: 'Contrato gerado a partir da proposta', sortOrder: 995 },
].map(x => ({ ...x, type: 'system', status: 'active' }));

const CUSTOM = [
  { key: 'reproved_by_rating', descriptionPtBr: 'Reprovada por rating', objectivePtBr: 'Rating insuficiente' },
  { key: 'reproved_by_dropped_debts', descriptionPtBr: 'Reprovada por dívidas baixadas', objectivePtBr: 'Pendências identificadas' },
  { key: 'conditioned', descriptionPtBr: 'Condicionada', objectivePtBr: 'Aprovação condicionada' },
  { key: 'approved', descriptionPtBr: 'Aprovada', objectivePtBr: 'Aprovação intermediária' },
  { key: 'awaiting_registry_for_inspection', descriptionPtBr: 'Aguardando matrícula para solicitação de vistoria', objectivePtBr: 'Aguardando matrícula' },
  { key: 'awaiting_report', descriptionPtBr: 'Aguardando laudo', objectivePtBr: 'Aguardando laudo de avaliação' },
  { key: 'report_valid', descriptionPtBr: 'Laudo válido', objectivePtBr: 'Laudo conferido conforme' },
  { key: 'report_invalid', descriptionPtBr: 'Laudo inválido', objectivePtBr: 'Laudo inválido' },
  { key: 'report_lower_value', descriptionPtBr: 'Laudo em menor valor', objectivePtBr: 'Valor abaixo do solicitado' },
  { key: 'report_value_requested', descriptionPtBr: 'Laudo no valor solicitado', objectivePtBr: 'Valor conforme solicitado' },
  { key: 'inspection_review_requested', descriptionPtBr: 'Solicitação de revisão de laudo', objectivePtBr: 'Revisão do laudo solicitada' },
  { key: 'buyer_forms', descriptionPtBr: 'Formulários compradores', objectivePtBr: 'Preenchimento de formulários' },
  { key: 'seller_forms', descriptionPtBr: 'Formulários vendedores', objectivePtBr: 'Preenchimento de formulários' },
  { key: 'awaiting_documents', descriptionPtBr: 'Aguardando documentos', objectivePtBr: 'Aguardando documentação' },
  { key: 'compliance', descriptionPtBr: 'Conformidade', objectivePtBr: 'Análise de conformidade' },
  { key: 'non_compliant', descriptionPtBr: 'Inconforme', objectivePtBr: 'Resultado inconforme' },
  { key: 'compliant', descriptionPtBr: 'Conforme', objectivePtBr: 'Resultado conforme' },
  { key: 'awaiting_signature_date', descriptionPtBr: 'Aguardando data de assinatura', objectivePtBr: 'Agendamento de assinatura' },
  { key: 'expired_evaluation', descriptionPtBr: 'Avaliação vencida', objectivePtBr: 'Validade de avaliação expirada' },
].map((x, i) => ({ ...x, type: 'custom', status: 'active', sortOrder: 100 + i }));

export async function bootstrapProposalStatuses() {
  const docs = [...SYSTEM, ...CUSTOM].map(s => ({
    updateOne: {
      filter: { key: s.key, correspondentId: '*' },
      update: {
        $set: {
          descriptionPtBr: s.descriptionPtBr,
          objectivePtBr: s.objectivePtBr,
          type: s.type,
          correspondentId: '*',
          sendEmail: false,
          sendSMS: false,
          sendPush: false,
          defaultDeadlineDays: s.defaultDeadlineDays ?? (s.type === 'system' ? 3 : 3),
          status: 'active',
          sortOrder: s.sortOrder ?? 0,
        },
      },
      upsert: true,
    },
  }));

  try {
    const res = await ProposalStatus.bulkWrite(docs, { ordered: false });
    logger.info('proposal_status_bootstrap_ok', { upserts: res.upsertedCount, modified: res.modifiedCount });
  } catch (err) {
    logger.error('proposal_status_bootstrap_error', { msg: err.message, code: err.code, name: err.name, stack: err.stack });
    throw err;
  }
}
