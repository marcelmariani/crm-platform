// src/models/contract.js
import mongoose from 'mongoose';
import contractStatusModel from './contractStatus.js';

const pad8 = (n) => String(Number(n || 0)).padStart(8, '0');

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

const contractProductSchema = new mongoose.Schema({
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

const contractSchema = new mongoose.Schema({
  // Sequência do contrato (NUMÉRICO). A API expõe zero-padded no response.
  sequenceNumber: { type: Number, index: true, required: true },

  // Vínculo com a proposta
  proposalId: { type: mongoose.Schema.Types.ObjectId, index: true, required: true },
  // Sequência da proposta (NUMÉRICO). A API expõe zero-padded no response.
  proposalSequenceNumber: { type: Number, index: true, required: true },

  buyerId:  { type: [mongoose.Schema.Types.ObjectId], required: true, index: true, validate: nonEmptyArray },
  sellerId: { type: [mongoose.Schema.Types.ObjectId], required: true, index: true, validate: nonEmptyArray },
  products: { type: [contractProductSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
  status: { type: [StatusStackSchema], default: [] },
  auditInformation: { type: [AuditInformationSchema], default: [] },

  createdAtAgentId: { type: String, index: true },
  createdAtRealEstateId: { type: String, index: true },
  createdAtBankCorrespondentId: { type: String, index: true, required: true },
}, { timestamps: true, versionKey: false, collection: 'contracts' });

// Único por correspondente + número
contractSchema.index({ createdAtBankCorrespondentId: 1, sequenceNumber: 1 }, { unique: true });

// Virtuals derivados para exibição
contractSchema.virtual('contractNumber').get(function () {
  return Number.isFinite(this.sequenceNumber) ? pad8(this.sequenceNumber) : undefined;
});
contractSchema.virtual('proposalNumber').get(function () {
  return Number.isFinite(this.proposalSequenceNumber) ? pad8(this.proposalSequenceNumber) : undefined;
});

// Normaliza saída JSON/Objeto incluindo derivados
function transformOut(_doc, ret) {
  ret.contractNumber = Number.isFinite(ret.sequenceNumber) ? pad8(ret.sequenceNumber) : undefined;
  ret.proposalNumber = Number.isFinite(ret.proposalSequenceNumber) ? pad8(ret.proposalSequenceNumber) : undefined;
  return ret;
}
contractSchema.set('toJSON', { virtuals: true, versionKey: false, transform: transformOut });
contractSchema.set('toObject', { virtuals: true, versionKey: false, transform: transformOut });

contractSchema.pre('validate', async function(next) {
  try {
    const s0 = Array.isArray(this.status) && this.status.length ? this.status[0] : null;
    if (!s0 || !s0.status) return next(new Error('status[0].status é obrigatório'));
    const row = await contractStatusModel.findOne({ key: s0.status, $or: [{ isActive: true }, { status: 'active' }] }).lean();
    if (!row) return next(new Error('invalid_contract_status'));
    return next();
  } catch (e) { return next(e); }
});

export default mongoose.model('contract', contractSchema);
export { contractSchema, contractProductSchema };
