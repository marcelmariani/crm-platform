// src/models/agent.model.js
import mongoose from 'mongoose';

/** Estados permitidos e regras de transição */
const STATUS = ['created', 'active', 'inactive'];

function canTransition(from, to) {
  if (from === 'inactive') return false; // inativo não sai
  if (from === 'created') return to === 'active' || to === 'inactive';
  if (from === 'active')  return to === 'inactive';
  return false;
}

const agentSchema = new mongoose.Schema(
  {
    name:          { type: String, required: true, trim: true },
    email:         { type: String, required: true, trim: true, lowercase: true },
    phoneNumber:   { type: String, trim: true }, 
    whatsappJid:   { type: String, trim: false },    
    licenseNumber: { type: String, required: true, unique: true, trim: true },
    ownerAuthId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    realEstateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'RealEstate' }],
    status:        { type: String, enum: STATUS, default: 'created', required: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/** Índice parcial: único apenas quando status = 'active' e phoneNumber preenchido */
agentSchema.index(
  { phoneNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'active',
      phoneNumber: { $exists: true, $ne: '' },
    },
  }
);

/** Índice composto para acelerar buscas por phoneNumber + status */
agentSchema.index({ phoneNumber: 1, status: 1 });

/** Outros índices úteis */
agentSchema.index({ ownerAuthId: 1 });
/** Índice composto para acelerar buscas por whatsappJid + status */
agentSchema.index({ whatsappJid: 1, status: 1 });

/** API utilitária */
agentSchema.statics.canTransition = canTransition;
agentSchema.methods.canTransitionTo = function (newStatus) {
  return canTransition(this.status, newStatus);
};

/** Validações em save(): início em created, transições válidas e phoneNumber obrigatório para active */
agentSchema.pre('save', async function (next) {
  // criação deve iniciar em "created"
  if (this.isNew && this.status !== 'created') {
    return next(new Error(`New records must start in "created" (got "${this.status}")`));
  }

  // validar transição em save()
  if (!this.isNew && this.isModified('status')) {
    const current = await this.constructor.findById(this._id).select('status').lean();
    if (current && !canTransition(current.status, this.status)) {
      return next(new Error(`Invalid status transition from "${current.status}" to "${this.status}"`));
    }
  }

  // se vai ficar 'active', exigir phoneNumber
  if (this.status === 'active' && (!this.phoneNumber || !String(this.phoneNumber).trim())) {
    return next(new Error('phoneNumber é obrigatório quando status = "active"'));
  }

  return next();
});

/** Enforce em updates atômicos (findOneAndUpdate / findByIdAndUpdate) */
agentSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  const newStatus =
    (Object.prototype.hasOwnProperty.call(update, 'status') && update.status) ??
    (update.$set && update.$set.status);

  if (newStatus) {
    if (!STATUS.includes(newStatus)) {
      return next(new Error(`Invalid status "${newStatus}". Allowed: ${STATUS.join(', ')}`));
    }

    const doc = await this.model.findOne(this.getQuery()).select('status phoneNumber').lean();
    if (doc) {
      if (doc.status !== newStatus && !canTransition(doc.status, newStatus)) {
        return next(new Error(`Invalid status transition from "${doc.status}" to "${newStatus}"`));
      }

      // exigir phoneNumber quando transicionar para active
      if (newStatus === 'active') {
        const incomingPhone =
          (Object.prototype.hasOwnProperty.call(update, 'phoneNumber') && update.phoneNumber) ??
          (update.$set && update.$set.phoneNumber) ??
          doc.phoneNumber;

        if (!incomingPhone || !String(incomingPhone).trim()) {
          return next(new Error('phoneNumber é obrigatório quando status = "active"'));
        }
      }
    }
  }

  this.setOptions({ runValidators: true, context: 'query' });
  return next();
});

/** Helper: buscar somente ativo por phoneNumber */
agentSchema.statics.findActiveByPhoneNumber = function (phoneNumber) {
  return this.findOne({ phoneNumber, status: 'active' }).lean();
};

/** Helper: buscar somente ativo por whatsappJid */
agentSchema.statics.findActiveByWhatsappJid = function (whatsappJid) {
  return this.findOne({ whatsappJid, status: 'active' }).lean();
};

const Agent = mongoose.models.Agent || mongoose.model('Agent', agentSchema);
export { Agent };
export default Agent;
