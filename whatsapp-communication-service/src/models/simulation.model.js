/* === D:\SmartIASystems\whatsapp-communication-service\src\models\SimulationRequest.js === */
// src/models/SimulationRequest.js
import mongoose from "mongoose";

const MAIN_FLOW = ['CREATED', 'COLLECTING', 'PROCESSING', 'COMPLETED'];
const TERMINAL = ['FAILED', 'CANCELLED'];

const historyEntrySchema = new mongoose.Schema({
  simulatorParam: { type: String, required: true },
  value: mongoose.Schema.Types.Mixed,
  type: { type: String, enum: ["auto", "manual"], required: true },
  timestamp: { type: Date, default: Date.now }
}, { _id: false });

const SimulationRequestSchema = new mongoose.Schema({
  whatsappPhoneNumber: String,
  whatsappPhoneNumberUser: String,
  idAdminConfiguration: String,
  creditRules: mongoose.Schema.Types.Mixed,
  stepIndex: Number,
  expectedParam: String, // <-- garante retomada no step correto
  collectedData: Object,
  history: [historyEntrySchema],
  status: {
    type: String,
    enum: [...MAIN_FLOW, ...TERMINAL],
    default: 'CREATED'
  },
  statusTimestamps: {
    CREATED:    { type: Date, default: Date.now },
    COLLECTING: Date,
    PROCESSING: Date,
    COMPLETED:  Date,
    FAILED:     Date,
    CANCELLED:  Date
  },
  result: {
    simulationId: { type: String, index: true },
    status:  { type: String },
  },
  proposalId: { type: String },
  proposalSequenceNumber: { type: Number },
  callbackReceivedAt: { type: Date }
});

// Valida e executa transição de status
SimulationRequestSchema.methods.updateStatus = async function(newStatus) {
  const current = this.status;

  if (![...MAIN_FLOW, ...TERMINAL].includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  if (current === 'CANCELLED') {
    throw new Error(`Cannot transition from ${current}`);
  }
  if (['FAILED', 'CANCELLED'].includes(newStatus)) {
    this.status = newStatus;
    this.statusTimestamps[newStatus] = new Date();
    return this.save();
  }
  if (current === 'FAILED') {
    if (MAIN_FLOW.includes(newStatus) && MAIN_FLOW.indexOf(newStatus) <= MAIN_FLOW.indexOf('PROCESSING')) {
      this.status = newStatus;
      this.statusTimestamps[newStatus] = new Date();
      return this.save();
    }
    throw new Error(`Cannot transition from ${current} to ${newStatus}`);
  }
  if (MAIN_FLOW.includes(current) && MAIN_FLOW.includes(newStatus)) {
    const curIdx = MAIN_FLOW.indexOf(current);
    const newIdx = MAIN_FLOW.indexOf(newStatus);
    if (newIdx < curIdx) {
      throw new Error(`Cannot transition backwards from ${current} to ${newStatus}`);
    }
    this.status = newStatus;
    this.statusTimestamps[newStatus] = this.statusTimestamps[newStatus] || new Date();
    return this.save();
  }
  throw new Error(`Invalid transition from ${current} to ${newStatus}`);
};

export default mongoose.model('SimulationRequest', SimulationRequestSchema);
