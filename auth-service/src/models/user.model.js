// src/models/User.js
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const userSchema = new Schema({
  userName: { type: String, required: true, trim: true }, // removed unique:true
  password: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  groupId: { type: Schema.Types.ObjectId, ref: 'Group', required: true }
}, {
  timestamps: true,
  versionKey: false
});

// Único parcial apenas para ativos
userSchema.index(
  { userName: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

export default model('User', userSchema);
