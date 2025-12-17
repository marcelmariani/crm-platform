import mongoose, { Schema } from 'mongoose';

const caixaSimulatorSchema = new Schema({
  dadosInput:   { type: Schema.Types.Mixed, required: true },
  dadosOutput:  { type: Schema.Types.Mixed },
  driveFileId:  { type: String },
  callbackUrl:  { type: String },
  status:       { type: String, enum: ['success','error'], required: true },
  errorMessage: { type: String, default: null }
}, {
  timestamps: true,
  versionKey: false
});

export default mongoose.model('caixaSimulator', caixaSimulatorSchema);
