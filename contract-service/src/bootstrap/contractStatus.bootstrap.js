// src/bootstrap/contractStatus.bootstrap.js
import ContractStatus from '../models/contractStatus.js';
import logger from '../config/logger.js';

const SEED = [
  { key: 'draft',               descriptionPtBr: 'Rascunho',                  defaultDeadlineDays: 7 },
  { key: 'awaiting_documents',  descriptionPtBr: 'Aguardando documentos',     defaultDeadlineDays: 7 },
  { key: 'in_review',           descriptionPtBr: 'Em análise interna',        defaultDeadlineDays: 5 },
  { key: 'awaiting_signatures', descriptionPtBr: 'Aguardando assinaturas',    defaultDeadlineDays: 7 },
  { key: 'signed',              descriptionPtBr: 'Assinado',                  defaultDeadlineDays: 2 },
  { key: 'submitted_to_bank',   descriptionPtBr: 'Enviado ao banco',          defaultDeadlineDays: 10 },
  { key: 'bank_requirements',   descriptionPtBr: 'Exigências do banco',       defaultDeadlineDays: 10 },
  { key: 'approved',            descriptionPtBr: 'Aprovado pelo banco',       defaultDeadlineDays: 3 },
  { key: 'rejected',            descriptionPtBr: 'Reprovado pelo banco',      defaultDeadlineDays: 0 },
  { key: 'active',              descriptionPtBr: 'Contrato vigente',          defaultDeadlineDays: 3650 },
  { key: 'settled',             descriptionPtBr: 'Quitado/Encerrado',         defaultDeadlineDays: 0 },
  { key: 'canceled',            descriptionPtBr: 'Cancelado',                 defaultDeadlineDays: 0 },
  { key: 'expired',             descriptionPtBr: 'Expirado por prazo',        defaultDeadlineDays: 0 },
];

export async function bootstrapcontractStatuses() {
  for (const row of SEED) {
    await ContractStatus.updateOne(
      { key: row.key },
      {
        $set: {
          descriptionPtBr: row.descriptionPtBr,
          type: 'system',
          status: 'active',
          isActive: true,
          defaultDeadlineDays: row.defaultDeadlineDays ?? 3,
        },
      },
      { upsert: true }
    );
  }
  const count = await ContractStatus.countDocuments();
  logger.info(`contract-status bootstrap done. total=${count}`);
}
