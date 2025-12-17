// src/models/productModel.js
import mongoose from 'mongoose';

const STATUS = ['active', 'inactive'];

function canTransition(from, to) {
  if (from === to) return true;
  if (from === 'inactive') return false;
  if (from === 'active')  return to === 'inactive';
  return false;
}

const productSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, alias: 'codigo' },
  description: { type: String, required: true, alias: 'descricao' },
  commissionPercentage: { type: Number, required: true, alias: 'percentualComissao' },
  commissionLimit: { type: Number, required: true, alias: 'valorLimiteComissao' },
  status:{ type: String, enum: STATUS, default: 'active' },
}, { timestamps: true, versionKey: false });

productSchema.statics.canTransition = canTransition;
productSchema.methods.canTransitionTo = function (newStatus) {
  return canTransition(this.status, newStatus);
};

productSchema.pre('save', async function (next) {
  if (this.isNew || !this.isModified('status')) return next();
  const current = await this.constructor.findById(this._id).select('status').lean();
  if (!current) return next();
  if (!canTransition(current.status, this.status)) {
    const err = new Error(`Invalid status transition from "${current.status}" to "${this.status}"`);
    err.status = 422;
    return next(err);
  }
  return next();
});

productSchema.pre('findOneAndUpdate', async function (next) {
  const update = this.getUpdate() || {};
  const newStatus =
    (Object.prototype.hasOwnProperty.call(update, 'status') && update.status) ??
    (update.$set && update.$set.status);

  if (!newStatus) return next();

  if (!STATUS.includes(newStatus)) {
    const err = new Error(`Invalid status "${newStatus}". Allowed: ${STATUS.join(', ')}`);
    err.status = 422;
    return next(err);
  }

  const doc = await this.model.findOne(this.getQuery()).select('status').lean();
  if (!doc) return next();

  if (!canTransition(doc.status, newStatus)) {
    const err = new Error(`Invalid status transition from "${doc.status}" to "${newStatus}"`);
    err.status = 422;
    return next(err);
  }
  return next();
});

export default mongoose.models.Product || mongoose.model('Product', productSchema);