// src/models/proposalModel.js
import mongoose from 'mongoose';
import ProposalStatusModel from './proposalStatus.js';

const StatusHistorySchema = new mongoose.Schema({
  from: { type: String, lowercase: true, trim: true },
  to: { type: String, required: true, lowercase: true, trim: true },
  note: { type: String, trim: true },
  changedByAuthId: { type: String, index: true },
  changedByUserName: { type: String },
  changedAt: { type: Date, default: Date.now },
}, { _id: false });

const StatusStackSchema = new mongoose.Schema({
  status: { type: String, required: true, lowercase: true, trim: true },
  statusStartedAt: { type: Date, default: Date.now },
  statusDeadlineAt: { type: Date },
  statusHistory: { type: [StatusHistorySchema], default: [] },
  statusPtBr: { type: String },
  statusType: { type: String, enum: ['system', 'custom'] },
  statusState: { type: String, enum: ['active', 'inactive'] },
}, { _id: false });

const AuditInformationSchema = new mongoose.Schema({
  createdByAuthId: { type: String },
  createdByUserName: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { _id: false });

const ProposalProductSchema = new mongoose.Schema({
  productId: { type: mongoose.Schema.Types.ObjectId, required: true },
  financingType: { type: String, required: true },
  purpose: { type: String, required: true },
  unitPrice: { type: Number, required: true },
  clientHasProperty: { type: Boolean, required: true },
  requestPortability: { type: Boolean, required: true },
  authorizeLGPD: { type: Boolean, required: true },
  requestBankRelationship: { type: Boolean, required: true },
  useFGTS: { type: Boolean, required: true },
  clientBenefitedFGTS: { type: Boolean, required: true },
  coBuyer: { type: Boolean, default: false },
}, { _id: false });

const nonEmptyArray = {
  validator: (v) => Array.isArray(v) && v.length > 0,
  message: 'lista vazia',
};

const ProposalSchema = new mongoose.Schema({
  // Sequência numérica por correspondente
  sequenceNumber: { type: Number, index: true }, // ex.: 1

  // Sequência do contrato vinculado (numérica)
  contractSequenceNumber: { type: Number, index: true },

  buyerId:  { type: [mongoose.Schema.Types.ObjectId], required: true, index: true, validate: nonEmptyArray },
  sellerId: { type: [mongoose.Schema.Types.ObjectId], index: true },
  products: { type: [ProposalProductSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
  status: { type: [StatusStackSchema], default: [] },
  auditInformation: { type: [AuditInformationSchema], default: [] },

  createdAtAgentId: { type: String, index: true },
  createdAtRealEstateId: { type: String, index: true },
  createdAtBankCorrespondentId: { type: String, index: true },
}, { timestamps: true, versionKey: false });

// Único por correspondente + número
ProposalSchema.index({ createdAtBankCorrespondentId: 1, sequenceNumber: 1 }, { unique: true });

// Valida status[0].status
ProposalSchema.pre('validate', async function(next) {
  try {
    const s0 = Array.isArray(this.status) && this.status.length ? this.status[0] : null;
    if (!s0 || !s0.status) return next(new Error('status[0].status é obrigatório'));
    const row = await ProposalStatusModel.findOne({ key: s0.status, $or: [{ isActive: true }, { status: 'active' }] }).lean();
    if (!row) return next(new Error('invalid_proposal_status'));
    return next();
  } catch (e) { return next(e); }
});

export default mongoose.model('Proposal', ProposalSchema);
export { ProposalSchema, ProposalProductSchema };
