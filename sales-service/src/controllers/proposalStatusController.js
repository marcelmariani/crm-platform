import ProposalStatus from '../models/proposalStatus.js';

export async function listStatuses(req, res) {
  const q = {};
  if (req.query?.status) q.status = String(req.query.status).toLowerCase();
  if (req.query?.type) q.type = String(req.query.type).toLowerCase();
  const list = await ProposalStatus.find(q).sort({ sortOrder: 1 }).lean();
  res.json(list);
}

export async function getStatus(req, res) {
  const doc = await ProposalStatus.findById(req.params.id).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  res.json(doc);
}

export async function createStatus(req, res) {
  const body = req.body || {};
  const doc = await ProposalStatus.create({
    key: String(body.key).toLowerCase(),
    descriptionPtBr: body.descriptionPtBr,
    objectivePtBr: body.objectivePtBr,
    type: body.type === 'system' ? 'system' : 'custom',
    correspondentId: body.correspondentId || '*',
    sendEmail: !!body.sendEmail,
    sendSMS: !!body.sendSMS,
    sendPush: !!body.sendPush,
    defaultDeadlineDays: Number(body.defaultDeadlineDays ?? 3),
    status: body.status === 'inactive' ? 'inactive' : 'active',
    sortOrder: Number(body.sortOrder ?? 0),
  });
  res.status(201).json(doc);
}

export async function updateStatus(req, res) {
  const body = req.body || {};
  const doc = await ProposalStatus.findByIdAndUpdate(
    req.params.id,
    {
      $set: {
        descriptionPtBr: body.descriptionPtBr,
        objectivePtBr: body.objectivePtBr,
        type: body.type === 'system' ? 'system' : 'custom',
        correspondentId: body.correspondentId || '*',
        sendEmail: !!body.sendEmail,
        sendSMS: !!body.sendSMS,
        sendPush: !!body.sendPush,
        defaultDeadlineDays: Number(body.defaultDeadlineDays ?? 3),
        status: body.status === 'inactive' ? 'inactive' : 'active',
        sortOrder: Number(body.sortOrder ?? 0),
      },
    },
    { new: true }
  ).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  res.json(doc);
}

export async function deleteStatus(req, res) {
  const out = await ProposalStatus.findByIdAndDelete(req.params.id);
  if (!out) return res.status(404).json({ error: 'not_found' });
  res.status(204).send();
}
