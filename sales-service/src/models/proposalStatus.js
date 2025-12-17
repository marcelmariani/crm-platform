import mongoose from 'mongoose';

const ProposalStatusSchema = new mongoose.Schema({
  key: { type: String, required: true, lowercase: true, trim: true }, // sem unique
  descriptionPtBr: { type: String, required: true, trim: true },
  objectivePtBr: { type: String, required: true, trim: true },

  // era isSystemic
  type: { type: String, enum: ['system', 'custom'], default: 'custom', index: true },

  correspondentId: { type: String, default: '*', index: true },

  sendEmail: { type: Boolean, default: false },
  sendSMS: { type: Boolean, default: false },
  sendPush: { type: Boolean, default: false },

  defaultDeadlineDays: { type: Number, default: 3, min: 0 },

  // era isActive
  status: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },

  sortOrder: { type: Number, default: 0 },
}, {
  timestamps: true,
  versionKey: false,
  collection: 'proposalstatus',
});

// único por (key, correspondentId)
ProposalStatusSchema.index({ key: 1, correspondentId: 1 }, { unique: true });

export default mongoose.model('ProposalStatus', ProposalStatusSchema);
