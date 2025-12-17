// src/models/Group.js
import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const groupSchema = new Schema({
  name:     { type: String, required: true, unique: true, trim: true },
  parent:   { type: Schema.Types.ObjectId, ref: 'Group', default: null },
  ancestors:[{ type: Schema.Types.ObjectId, ref: 'Group' }],
  resources:[{ type: Schema.Types.ObjectId, ref: 'Resource', default: [] }],
  status: {
    type: String,
    enum: ['active','inactive'],
    default: 'active'
  }
}, {
  timestamps: true,
  versionKey: false
});

groupSchema.pre('save', async function(next) {
  if (!this.isModified('parent')) return next();
  if (this.parent) {
    const parentGroup = await this.constructor.findById(this.parent);
    this.ancestors = parentGroup
      ? [...parentGroup.ancestors, parentGroup._id]
      : [];
  } else {
    this.ancestors = [];
  }
  next();
});

export default model('Group', groupSchema);
