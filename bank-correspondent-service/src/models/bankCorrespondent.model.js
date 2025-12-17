import mongoose from 'mongoose';

const BankCorrespondentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 3, maxlength: 120, index: true },
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      set: (v) => v?.toUpperCase(),
    },
    bankId: { type: String, required: true, trim: true },
    ownerAuthId: { type: String, required: true, index: true },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
    },
    contactPhone: { type: String, trim: true },
    status: {
      type: String,
      enum: ['created', 'active', 'inactive'],
      default: 'created',
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
  }
);

// Índices compostos
BankCorrespondentSchema.index({ name: 1, ownerAuthId: 1 });
BankCorrespondentSchema.index({ code: 1 }, { unique: true });

// Hook de FSM no save
BankCorrespondentSchema.pre('save', function (next) {
  if (!this.isModified('status')) return next();

  const transitions = {
    created: ['active', 'inactive'],
    active: ['inactive'],
    inactive: [],
  };

  const allowed = transitions[this.$__.priorDoc?.status || 'created'] || [];
  if (!allowed.includes(this.status) && this.isModified('status')) {
    return next(new Error(`Invalid status transition to ${this.status}`));
  }
  next();
});

// Hook de FSM no update
BankCorrespondentSchema.pre('findOneAndUpdate', function (next) {
  const update = this.getUpdate();
  if (!update.status) return next();

  const currentStatus = this.getQuery().status || 'created';
  const transitions = {
    created: ['active', 'inactive'],
    active: ['inactive'],
    inactive: [],
  };

  if (!transitions[currentStatus]?.includes(update.status)) {
    return next(new Error(`Invalid status transition to ${update.status}`));
  }

  this.setOptions({ runValidators: true, context: 'query' });
  next();
});

export default mongoose.model('BankCorrespondent', BankCorrespondentSchema);
