// Contador por correspondente
import mongoose from 'mongoose';

const ContractSequenceSchema = new mongoose.Schema({
  bankCorrespondentId: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, required: true, default: 0 },
}, { versionKey: false, collection: 'contract_sequences' });

export default mongoose.model('ContractSequence', ContractSequenceSchema);
