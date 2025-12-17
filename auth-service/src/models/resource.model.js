// src/models/Resource.js
import mongoose from 'mongoose';

const resourceSchema = new mongoose.Schema({
  resourceName: { type: String, required: true, unique: true, trim: true },
  status: { type: String, enum: ['active','inactive'], default: 'active' }
}, {
  timestamps: true,
  versionKey: false
});

export default mongoose.model('Resource', resourceSchema);
