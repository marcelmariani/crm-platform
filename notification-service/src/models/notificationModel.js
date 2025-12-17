/* === D:\SmartIASystems\notification-service\src\models\notificationModel.js === */
import mongoose from 'mongoose';

const auditSchema = new mongoose.Schema(
  {
    createdByAuthId: { type: String, index: true },
    createdByUserName: { type: String },
    createdByGroupId: { type: String, index: true },
    createdAtRealEstateId: { type: String, index: true },
    createdAtBankCorrespondentId: { type: String, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    event:   { type: String, required: true, index: true },
    payload: { type: Object, required: true },
    status:  { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending', index: true },
    sentAt:  Date,
    auditInformation: { type: [auditSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

notificationSchema.set('collection', 'notifications');

// índices gerais
notificationSchema.index({ createdAt: -1 });
notificationSchema.index({ 'auditInformation.createdByAuthId': 1, createdAt: -1 });
notificationSchema.index({ 'auditInformation.createdByGroupId': 1, createdAt: -1 });
notificationSchema.index({ 'auditInformation.createdAtRealEstateId': 1, createdAt: -1 });
notificationSchema.index({ 'auditInformation.createdAtBankCorrespondentId': 1, createdAt: -1 });

// evitar duplicidade de e-mail para mudança de status de PROPOSTA
/*notificationSchema.index(
  { event: 1, 'payload.proposalId': 1, 'payload.toStatus': 1, status: 1 },
  {
    name: 'uniq_sent_proposal_status',
    unique: true,
    partialFilterExpression: {
      status: 'sent',
      event: { $in: ['sales.proposal.status_changed', 'ProposalStatusChanged'] },
    },
  }
);*/

// evitar duplicidade de e-mail para mudança de status de CONTRATO
/*notificationSchema.index(
  { event: 1, 'payload.contractId': 1, 'payload.toStatus': 1, status: 1 },
  {
    name: 'uniq_sent_contract_status',
    unique: true,
    partialFilterExpression: {
      status: 'sent',
      event: {
        $in: [
          'contract.status_changed',
          'contracts.contract.status_changed',
          'sales.contract.status_changed',
          'ContractStatusChanged',
        ],
      },
    },
  }
);*/

export default mongoose.model('Notification', notificationSchema);
