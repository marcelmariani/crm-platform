// src/models/Bank.js
import mongoose from 'mongoose';

/** Estados permitidos e regras de transição */
const STATUS = ['active', 'inactive'];

function canTransition(from, to) {
  if (from === to) return true;           // idempotente
  if (from === 'inactive') return false;  // inativo não sai
  if (from === 'active')  return to === 'inactive';
  return false;
}

const bankSchema = new mongoose.Schema({
  name:  { type: String, required: true, trim: true },
  code:  { type: String, required: true, unique: true, trim: true, uppercase: true },
  status:{ type: String, enum: STATUS, default: 'active' },
}, {
  timestamps: true,
  versionKey: false,
});

/** API utilitária */
bankSchema.statics.canTransition = canTransition;
bankSchema.methods.canTransitionTo = function (newStatus) {
  return canTransition(this.status, newStatus);
};

/** Enforce em .save() (alterações após criação) */
bankSchema.pre('save', async function (next) {
  if (this.isNew || !this.isModified('status')) return next();

  const current = await this.constructor.findById(this._id).select('status').lean();
  if (!current) return next();

  if (!canTransition(current.status, this.status)) {
    return next(new Error(`Invalid status transition from "${current.status}" to "${this.status}"`));
  }
  return next();
});

/** Enforce em updates atômicos (findOneAndUpdate / findByIdAndUpdate) */
bankSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  const newStatus =
    (Object.prototype.hasOwnProperty.call(update, 'status') && update.status) ??
    (update.$set && update.$set.status);

  if (!newStatus) return next();

  if (!STATUS.includes(newStatus)) {
    return next(new Error(`Invalid status "${newStatus}". Allowed: ${STATUS.join(', ')}`));
  }

  const doc = await this.model.findOne(this.getQuery()).select('status').lean();
  if (!doc) return next();

  if (!canTransition(doc.status, newStatus)) {
    return next(new Error(`Invalid status transition from "${doc.status}" to "${newStatus}"`));
  }

  return next();
});

export default mongoose.models.Bank || mongoose.model('Bank', bankSchema);
