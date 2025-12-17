// Contador por correspondente bancário
import mongoose from 'mongoose';

const ProposalSequenceSchema = new mongoose.Schema({
  bankCorrespondentId: { type: String, required: true, unique: true, index: true },
  seq: { type: Number, required: true, default: 0 }, // próximo será seq+1
}, { versionKey: false, collection: 'proposal_sequences' });

export default mongoose.model('ProposalSequence', ProposalSequenceSchema);
