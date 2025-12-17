/* === D:\SmartIASystems\seller-service\src\models\sellerModel.js === */
// src/models/sellerModel.js
import mongoose from 'mongoose';

export const STATUS = ['created', 'active', 'inactive'];

function canTransition(from, to) {
  if (from === to) return false;
  if (from === 'created') return to === 'active' || to === 'inactive';
  if (from === 'active') return to === 'inactive';
  if (from === 'inactive') return to === 'active';
  return false;
}

const statusHistorySchema = new mongoose.Schema(
  {
    from: { type: String, enum: STATUS.concat([null]) },
    to: { type: String, enum: STATUS, required: true },
    note: { type: String },
    changedByAuthId: { type: String, index: true },
    changedByUserName: { type: String },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const sellerSchema = new mongoose.Schema(
  {
    documentNumber: { type: String, required: true, index: true },
    phoneNumber: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    birthDate: { type: Date },
    monthlyIncome: { type: Number },

    fiscalType: { type: String, enum: ['person', 'company'], required: false },

    status: { type: String, enum: STATUS, default: 'created', index: true },
    statusHistory: { type: [statusHistorySchema], default: [] },

    createdByAuthId: { type: String, index: true, required: true },
    createdByUserName: { type: String },
    createdByGroupId: { type: String, index: true },

    createdAtAgentId: { type: String, index: true },
    createdAtRealEstateId: { type: String, index: true },
    createdAtBankCorrespondentId: { type: String, index: true },
  },
  { timestamps: true, versionKey: false }
);

sellerSchema.index(
  { documentNumber: 1, createdByGroupId: 1 },
  { unique: true, sparse: true, name: 'uniq_doc_per_group' }
);

// Inicializa histórico na criação
sellerSchema.pre('save', function initHistory(next) {
  if (this.isNew) {
    this.status = this.status || 'created';
    this.statusHistory = (this.statusHistory || []).concat([
      {
        from: null,
        to: 'created',
        note: 'criação',
        changedByAuthId: this.createdByAuthId || null,
        changedByUserName: this.createdByUserName || null,
        changedAt: this.createdAt || new Date(),
      },
    ]);
  }
  next();
});

export { canTransition };
export default mongoose.model('seller', sellerSchema);
