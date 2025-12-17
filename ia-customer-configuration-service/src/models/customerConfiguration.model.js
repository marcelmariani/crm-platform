// File: src/models/customerConfiguration.model.js
import mongoose, { Types } from 'mongoose';

const InsuranceCompanySchema = new mongoose.Schema(
  {
    idInsuranceCompany:   { type: String, required: true, trim: true },
    insuranceCompanyName: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const CustomerConfigurationSchema = new mongoose.Schema(
  {
    name:                 { type: String, required: true, trim: true, minlength: 3, maxlength: 120, index: true },
    idAdminConfiguration: { type: Types.ObjectId, ref: 'IAAdminConfiguration', required: true },
    prompt:               { type: String, required: true },
    whatsappPhoneNumber:  { type: String, required: true, unique: true, index: true, trim: true },
    session:              { type: String },
    token:                { type: mongoose.Schema.Types.Mixed, default: {} },
    welcomeMessage:       { type: Boolean, default: false },
    welcomeMessageText:   { type: String, default: '' },
    goodByeMessage:       { type: Boolean, default: false },
    goodByeMessageText:   { type: String, default: '' },
    insuranceCompany:     { type: [InsuranceCompanySchema], default: [] },
    communicationType:    { type: String, enum: ['formal', 'informal'], required: true },
    status: {
      type: String,
      enum: ['created', 'active', 'inactive'],
      default: 'created',
      index: true
    }
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
    toJSON: { virtuals: true }
  }
);

// Virtual: expõe _id como idcustomerConfiguration
CustomerConfigurationSchema.virtual('idcustomerConfiguration').get(function () {
  return this._id?.toString();
});

// Regras de transição
const transitions = {
  created: ['active', 'inactive'],
  active:  ['inactive'],
  inactive:[]
};

// Validação de transição em validate/save
CustomerConfigurationSchema.pre('validate', async function(next) {
  // Se status não mudou, ok
  if (!this.isModified('status')) return next();

  const to = this.status ?? 'created';
  // Em docs novos, tratar default 'created' como nenhuma transição
  const from = this.isNew ? 'created' : ((await this.constructor.findById(this._id).select('status').lean())?.status || 'created');

  if (from === to) return next();
  if (!transitions[from]?.includes(to)) {
    return next(new Error(`Invalid status transition from ${from} to ${to}`));
  }
  next();
});

// Validação de transição em findOneAndUpdate
CustomerConfigurationSchema.pre('findOneAndUpdate', { query: true, document: false }, async function(next) {
  const update = this.getUpdate() || {};
  const to = (update.status ?? update.$set?.status);
  if (!to) return next();

  const doc = await this.model.findOne(this.getQuery()).select('status').lean();
  const from = doc?.status || 'created';

  if (from === to) return next();
  if (!transitions[from]?.includes(to)) {
    return next(new Error(`Invalid status transition from ${from} to ${to}`));
  }

  this.setOptions({ runValidators: true, context: 'query' });
  next();
});

export const CustomerConfiguration = mongoose.model('CustomerConfiguration', CustomerConfigurationSchema);
