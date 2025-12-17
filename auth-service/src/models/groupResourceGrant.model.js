// src/models/GroupResourceGrant.js
import mongoose from 'mongoose';

export const PERM = Object.freeze({ CREATE: 1, READ: 2, UPDATE: 4, DELETE: 8 });
export const SCOPES = Object.freeze({ OWN: 'own', OWN_LINKED: 'own+linked', ALL: 'all' });

const schema = new mongoose.Schema({
  groupId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  resourceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Resource', required: true },
  perms:        { type: Number, min: 0, max: 15, required: true },
  scope:        { type: String, enum: Object.values(SCOPES), default: SCOPES.OWN },
  // denormalizações opcionais para leitura
  groupName:    { type: String },
  resourceName: { type: String },
}, {
  timestamps: true,
  versionKey: false
});

// Garante 1 grant por par (group, resource)
schema.index({ groupId: 1, resourceId: 1 }, { unique: true });

export default mongoose.model('GroupResourceGrant', schema);
