// src/models/contractStatus.js
import mongoose from 'mongoose';

const contractStatusSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    descriptionPtBr: { type: String, required: true, trim: true },

    // Compatibilidade: ambos os campos abaixo coexistem
    type: { type: String, enum: ['system', 'custom'], default: 'system' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },

    // Flag legada, usada em algumas consultas
    isActive: { type: Boolean, default: true },

    defaultDeadlineDays: { type: Number, default: 3 },
  },
  { timestamps: true, versionKey: false, collection: 'contract_statuses' }
);

export default mongoose.model('contract_status', contractStatusSchema);
