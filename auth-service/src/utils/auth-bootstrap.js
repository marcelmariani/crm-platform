// src/utils/auth-bootstrap.js
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import config from '../config/auth.config.js';

import User from '../models/user.model.js';
import Group from '../models/group.model.js';
import Resource from '../models/resource.model.js';
import GroupResourceGrant from '../models/groupResourceGrant.model.js';

const PERM   = { CREATE: 1, READ: 2, UPDATE: 4, DELETE: 8 };
const SCOPES = { OWN: 'own', OWN_LINKED: 'own+linked', ALL: 'all' };
const SALT_ROUNDS = 10;

/* -------------------- helpers -------------------- */
async function ensureFirstAdmin() {
  const count = await User.estimatedDocumentCount();
  if (count > 0) return;

  let adminGroup = await Group.findOne({ name: 'admin' });
  if (!adminGroup) {
    adminGroup = await Group.create({
      name: 'admin',
      isAdmin: true,
      parent: null,
      ancestors: [],
      resources: [],
      status: 'active',
    });
  }

  const adminPass = config.jwt.adminPass;
  if (!adminPass) throw new Error('JWT_ADMIN_PASS indefinido');

  const passwordHash = await bcrypt.hash(adminPass, SALT_ROUNDS);
  await User.create({
    userName: 'admin',
    password: passwordHash,
    status: 'active',
    groupId: adminGroup._id,
  });
}

async function upsertResource(resourceName) {
  let r = await Resource.findOne({ resourceName }).lean();
  if (r) return r;
  r = await Resource.create({ resourceName, status: 'active' });
  return r.toObject();
}

async function computeAncestors(parentId) {
  if (!parentId) return [];
  const parent = await Group.findById(parentId).select('ancestors').lean();
  return parent ? [parentId, ...(parent.ancestors || [])] : [parentId];
}

async function upsertGroup({ name, parent = null, resources = [] }) {
  let g = await Group.findOne({ name });
  if (!g) {
    const ancestors = await computeAncestors(parent);
    g = await Group.create({ name, parent, ancestors, resources, status: 'active' });
    return g;
  }
  const current = new Set((g.resources || []).map(String));
  let changed = false;
  for (const rid of resources.map(String)) {
    if (!current.has(rid)) { g.resources.push(rid); changed = true; }
  }
  if (changed) await g.save();
  return g;
}

async function upsertGrant({ group, resource, perms, scope }) {
  return GroupResourceGrant.findOneAndUpdate(
    { groupId: group._id, resourceId: resource._id },
    { $set: { perms, scope, groupName: group.name, resourceName: resource.resourceName } },
    { upsert: true, new: true }
  ).lean();
}

async function upsertUser({ userName, password, groupId, status = 'active', forceReset = false }) {
  let u = await User.findOne({ userName });
  if (!u) {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    u = await User.create({ userName, password: hash, groupId, status });
    return u.toObject();
  }
  let changed = false;
  if (String(u.groupId) !== String(groupId)) { u.groupId = groupId; changed = true; }
  if (u.status !== status) { u.status = status; changed = true; }
  if (forceReset && password) { u.password = await bcrypt.hash(password, SALT_ROUNDS); changed = true; }
  if (changed) await u.save();
  return u.toObject();
}

/* -------------------- entry -------------------- */
/**
 * Executa o bootstrap do Auth (idempotente). Requer mongoose já conectado.
 */
export async function runAuthBootstrap({
  seedMode = process.env.SEED_MODE || 'no_production',
  forceReset = String(process.env.SEED_FORCE_RESET_PASSWORD).toLowerCase() === 'true',
} = {}) {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    throw new Error('Mongo não conectado; importe ./config/database.js antes');
  }

  await ensureFirstAdmin();

  // 1) Resources
  const resourceNames = [
    'bank-service',
    'bank-correspondent-service',
    'real-estate-service',
    'agent-service',
    // novos serviços
    'product-service',
    'contact-service',
    'contract-service',
    'sales-service',
    'notification-service',
    'seller-service', // <== adicionado
  ];
  const R = {};
  for (const rn of resourceNames) {
    R[rn] = await upsertResource(rn);
  }

  // 2) Groups
  const G = {};
  G.admin = await upsertGroup({
    name: 'admin',
    parent: null,
    resources: [
      R['bank-service']._id,
      R['bank-correspondent-service']._id,
      R['real-estate-service']._id,
      R['agent-service']._id,
      R['product-service']._id,
      R['notification-service']._id,
      R['contact-service']._id,
      R['contract-service']._id,
      R['sales-service']._id,
      R['seller-service']._id, // <== adicionado
    ],
  });

  G['bank-correspondent'] = await upsertGroup({
    name: 'bank-correspondent',
    parent: G.admin._id,
    resources: [
      R['bank-correspondent-service']._id,
      R['real-estate-service']._id,
      R['agent-service']._id,
      R['contact-service']._id,
      R['contract-service']._id,
      R['sales-service']._id,
      R['seller-service']._id, // <== adicionado
    ],
  });

  G['real-estate'] = await upsertGroup({
    name: 'real-estate',
    parent: G.admin._id,
    resources: [
      R['real-estate-service']._id,
      R['agent-service']._id,
      R['contact-service']._id,
      R['contract-service']._id,
      R['sales-service']._id,
      R['seller-service']._id, // <== adicionado
    ],
  });

  G.agent = await upsertGroup({
    name: 'agent',
    parent: G.admin._id,
    resources: [
      R['agent-service']._id,
      R['contact-service']._id,
      R['contract-service']._id,
      R['sales-service']._id,
      R['seller-service']._id, // <== adicionado
    ],
  });

  // 3) Grants
  // admin: full em todos
  for (const res of Object.values(R)) {
    await upsertGrant({
      group: G.admin,
      resource: res,
      perms: PERM.CREATE | PERM.READ | PERM.UPDATE | PERM.DELETE, // 15
      scope: SCOPES.ALL,
    });
  }

  // Regras existentes
  await upsertGrant({
    group: G['bank-correspondent'],
    resource: R['bank-correspondent-service'],
    perms: PERM.READ,
    scope: SCOPES.OWN,
  });
  await upsertGrant({
    group: G['bank-correspondent'],
    resource: R['real-estate-service'],
    perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
    scope: SCOPES.OWN_LINKED,
  });
  await upsertGrant({
    group: G['bank-correspondent'],
    resource: R['agent-service'],
    perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
    scope: SCOPES.OWN_LINKED,
  });
  await upsertGrant({
    group: G['real-estate'],
    resource: R['real-estate-service'],
    perms: PERM.READ,
    scope: SCOPES.OWN,
  });
  await upsertGrant({
    group: G['real-estate'],
    resource: R['agent-service'],
    perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
    scope: SCOPES.OWN_LINKED,
  });
  await upsertGrant({
    group: G.agent,
    resource: R['agent-service'],
    perms: PERM.READ,
    scope: SCOPES.OWN,
  });

  // 3.1) Regras recursivas: contact/contract/sales/seller
  const linkedServices = ['contact-service', 'contract-service', 'sales-service', 'seller-service']; // <== seller incluso
  for (const svc of linkedServices) {
    await upsertGrant({
      group: G['bank-correspondent'],
      resource: R[svc],
      perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
      scope: SCOPES.OWN_LINKED,
    });
    await upsertGrant({
      group: G['real-estate'],
      resource: R[svc],
      perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
      scope: SCOPES.OWN_LINKED,
    });
    await upsertGrant({
      group: G.agent,
      resource: R[svc],
      perms: PERM.CREATE | PERM.READ | PERM.UPDATE, // 7
      scope: SCOPES.OWN_LINKED,
    });
  }

  // 4) Users
  const usersProd = [
    { userName: 'admin',              groupKey: 'admin',              password: process.env.SEED_ADMIN_PASSWORD_PROD || config.jwt.adminPass },
    { userName: 'bank-correspondent', groupKey: 'bank-correspondent', password: process.env.SEED_DEFAULT_PASSWORD_PROD || config.jwt.adminPass },
    { userName: 'real-estate',        groupKey: 'real-estate',        password: process.env.SEED_DEFAULT_PASSWORD_PROD || config.jwt.adminPass },
    { userName: 'agent',              groupKey: 'agent',              password: process.env.SEED_DEFAULT_PASSWORD_PROD || config.jwt.adminPass },
  ];
  const usersDev = [
    { userName: 'admin',                        groupKey: 'admin',              password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'bank-correspondent-caixa',     groupKey: 'bank-correspondent', password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'real-estate-caixa',            groupKey: 'real-estate',        password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'agent-caixa',                  groupKey: 'agent',              password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'bank-correspondent-santander', groupKey: 'bank-correspondent', password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'real-estate-santander',        groupKey: 'real-estate',        password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
    { userName: 'agent-santander',              groupKey: 'agent',              password: process.env.SEED_DEFAULT_PASSWORD_DEV || config.jwt.adminPass },
  ];
  const list = seedMode === 'production' ? usersProd : usersDev;

  const groupByName = await Group.find({
    name: { $in: ['admin', 'bank-correspondent', 'real-estate', 'agent'] }
  }).select('_id name').lean();
  const map = Object.fromEntries(groupByName.map(g => [g.name, g._id]));

  for (const u of list) {
    await upsertUser({
      userName: u.userName,
      password: u.password,
      groupId: map[u.groupKey],
      status: 'active',
      forceReset,
    });
  }
}
