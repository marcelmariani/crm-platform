// src/models/RealEstate.js
import mongoose from 'mongoose';

/** Estados permitidos e regras de transição */
const STATUS = ['created', 'active', 'inactive'];

function canTransition(from, to) {
  if (from === 'inactive') return false;                           // inativo não sai
  if (from === 'created') return to === 'active' || to === 'inactive';
  if (from === 'active')  return to === 'inactive';
  return false;
}

/** Subdocumento de endereço */
const addressSchema = new mongoose.Schema({
  street:     { type: String, required: true, trim: true },
  number:     { type: String, trim: true },
  complement: { type: String, trim: true },
  city:       { type: String, required: true, trim: true },
  state:      { type: String, required: true, trim: true },
  zip:        { type: String, trim: true },
});

/** Schema principal */
const realEstateSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  cnpj:  { type: String, required: true, unique: true, trim: true },
  email: { type: String, trim: true },
  phone: { type: String, trim: true },

  address: { type: addressSchema, required: true },

  // vários correspondentes possíveis
  bankCorrespondentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BankCorrespondent' }],

  // ownership
  ownerAuthId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  status: { type: String, enum: STATUS, default: 'created' },
}, {
  timestamps: true,
  versionKey: false,
});

/** API de transição (útil em controllers/tests) */
realEstateSchema.statics.canTransition = canTransition;
realEstateSchema.methods.canTransitionTo = function (newStatus) {
  return canTransition(this.status, newStatus);
};

/** Enforce: criação deve iniciar em "created" */
realEstateSchema.pre('save', function (next) {
  if (this.isNew && this.status !== 'created') {
    return next(new Error(`New records must start in "created" (got "${this.status}")`));
  }
  return next();
});

/** Enforce: mudanças via .save() devem respeitar transições */
realEstateSchema.pre('save', async function (next) {
  if (this.isNew || !this.isModified('status')) return next();

  const current = await this.constructor.findById(this._id).select('status').lean();
  if (!current) return next(); // doc inexistente -> outro erro surgirá adiante

  if (!canTransition(current.status, this.status)) {
    return next(new Error(`Invalid status transition from "${current.status}" to "${this.status}"`));
  }
  return next();
});

/** Enforce: mudanças atômicas (findOneAndUpdate / findByIdAndUpdate) */
realEstateSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  const newStatus =
    (Object.prototype.hasOwnProperty.call(update, 'status') && update.status) ??
    (update.$set && update.$set.status);

  if (!newStatus) return next();

  if (!STATUS.includes(newStatus)) {
    return next(new Error(`Invalid status "${newStatus}". Allowed: ${STATUS.join(', ')}`));
  }

  const doc = await this.model.findOne(this.getQuery()).select('status').lean();
  if (!doc) return next(); // se não achou, outra validação cuidará

  if (doc.status === 'created' && newStatus === 'created') return next(); // idempotente
  if (!canTransition(doc.status, newStatus)) {
    return next(new Error(`Invalid status transition from "${doc.status}" to "${newStatus}"`));
  }

  return next();
});

export default mongoose.models.RealEstate
  || mongoose.model('RealEstate', realEstateSchema);
