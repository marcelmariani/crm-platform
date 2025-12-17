import ProposalStatus from '../models/proposalStatus.js';

export async function withStatusPtBr(doc) {
  if (!doc) return doc;
  const st = await ProposalStatus.findOne({ key: doc.status }).lean();
  if (st) {
    doc.statusPtBr = st.descriptionPtBr;
    doc.statusType = st.type;        // 'system' | 'custom'
    doc.statusState = st.status;     // 'active' | 'inactive'
  }
  return doc;
}

export async function withStatusPtBrArray(arr = []) {
  const keys = [...new Set(arr.map(d => d.status).filter(Boolean))];
  const map = new Map(
    (await ProposalStatus.find({ key: { $in: keys } }).lean()).map(s => [s.key, s])
  );
  return arr.map(d => {
    const st = map.get(d.status);
    if (st) {
      d.statusPtBr = st.descriptionPtBr;
      d.statusType = st.type;
      d.statusState = st.status;
    }
    return d;
  });
}
