// src/models/contact.js
import mongoose from 'mongoose';

const STATUS = ['active', 'inactive'];

function canTransition(from, to) {
  if (from === to) return true;
  if (from === 'inactive') return false;
  if (from === 'active')  return to === 'inactive';
  return false;
}

const contactSchema = new mongoose.Schema(
  {
    documentNumber: { type: String, required: true, index: true },
    phoneNumber: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    birthDate: { type: Date },
    monthlyIncome: { type: Number },

    // 'type' só muda para 'client' quando $locals.allowTypeToClient === true
    type: {
      type: String,
      enum: ['lead', 'client'],
      default: 'lead',
      immutable(doc) {
        // impede qualquer alteração fora do fluxo de qualificação
        return !(doc?.$locals && doc.$locals.allowTypeToClient === true);
      }
    },
    fiscalType: { type: String, enum: ['person', 'company'] },

    status:{ type: String, enum: STATUS, default: 'active', index: true },

    createdByAuthId: { type: String, index: true, required: true },
    createdByUserName: { type: String },
    createdByGroupId: { type: String, index: true },

    createdAtAgentId: { type: String, index: true },
    createdAtRealEstateId: { type: String, index: true },
    createdAtBankCorrespondentId: { type: String, index: true }
  },
  { timestamps: true, versionKey: false }
);

contactSchema.index(
  { documentNumber: 1, createdByGroupId: 1 },
  { unique: true, sparse: true, name: 'uniq_doc_per_group' }
);

// Guard-rail para updates diretos
function blockTypeClientOnUpdate(next) {
  const upd = this.getUpdate?.() || {};
  const set = upd.$set || upd;
  const wantsClient =
    (typeof set?.type !== 'undefined' && set.type === 'client');

  const allow = this.getOptions?.().context?.allowTypeToClient === true;

  if (wantsClient && !allow) {
    return next(new Error("Alteração de 'type' para 'client' permitida apenas via /contacts/:id/qualification"));
  }
  return next();
}

contactSchema.pre('findOneAndUpdate', blockTypeClientOnUpdate);
contactSchema.pre('updateOne', blockTypeClientOnUpdate);
contactSchema.pre('updateMany', blockTypeClientOnUpdate);

export default mongoose.model('Contact', contactSchema);
