// src/services/groupService.js
import Group from '../models/group.model.js';

export async function createGroup({ name, parent }) {
  const group = new Group({ name, parent: parent || null });
  await group.save();
  return group;
}
export async function getGroupById(id) { return Group.findById(id); }
export async function listGroups() { return Group.find(); }
export async function updateGroup(id, { name, parent }) {
  const group = await Group.findById(id);
  if (!group) throw new Error('Group not found');
  if (group.name === 'admin') throw new Error('Cannot modify admin group');
  if (name != null) group.name = name;
  if (parent != null) group.parent = parent;
  await group.save(); return group;
}
export async function deleteGroup(id) {
  const group = await Group.findById(id);
  if (!group) throw new Error('Group not found');
  if (group.name === 'admin') throw new Error('Cannot delete admin group');
  return Group.findByIdAndDelete(id);
}
export async function getAccessibleGroups(groupId) {
  const docs = await Group.find({ $or: [{ _id: groupId }, { ancestors: groupId }] }, { _id: 1 });
  return docs.map(d => d._id);
}