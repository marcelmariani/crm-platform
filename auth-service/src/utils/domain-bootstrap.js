// src/utils/domain-bootstrap.js
// Seed de DOMÍNIO para DEV/STAGING/TEST (bloqueado em produção).
// Cria Banks, BankCorrespondents, RealEstates e Agents, vinculando aos usuários do AUTH.

import mongoose from 'mongoose';

function inferSuffix() {
  const env = String(process.env.NODE_ENV || 'development').toLowerCase();
  if (env.startsWith('prod')) return 'production';
  if (env.startsWith('stag')) return 'staging';
  if (env.startsWith('test')) return 'test';
  return 'develop';
}
const ENV_SUFFIX = process.env.ENV_SUFFIX || inferSuffix();

export async function runDomainBootstrap() {
  if (ENV_SUFFIX === 'production' || String(process.env.NODE_ENV).toLowerCase() === 'production') {
    throw new Error('Domain bootstrap bloqueado em produção');
  }

  const {
    COMMON_MONGODB_URI = 'mongodb://root:root@localhost:27017',

    AUTH_MONGODB_URI = COMMON_MONGODB_URI,
    AUTH_MONGO_DATABASE = `${ENV_SUFFIX}-auth-service`,

    BANK_MONGODB_URI = COMMON_MONGODB_URI,
    BANK_MONGO_DATABASE = `${ENV_SUFFIX}-bank-service`,

    BC_MONGODB_URI = COMMON_MONGODB_URI,
    BC_MONGO_DATABASE = `${ENV_SUFFIX}-bank-correspondent-service`,

    RE_MONGODB_URI = COMMON_MONGODB_URI,
    RE_MONGO_DATABASE = `${ENV_SUFFIX}-real-estate-service`,

    AG_MONGODB_URI = COMMON_MONGODB_URI,
    AG_MONGO_DATABASE = `${ENV_SUFFIX}-agent-service`,
  } = process.env;

  const connect = (uri, dbName) => mongoose.createConnection(uri, { dbName });

  const authConn = connect(AUTH_MONGODB_URI, AUTH_MONGO_DATABASE);
  const bankConn = connect(BANK_MONGODB_URI, BANK_MONGO_DATABASE);
  const bcConn   = connect(BC_MONGODB_URI, BC_MONGO_DATABASE);
  const reConn   = connect(RE_MONGODB_URI, RE_MONGO_DATABASE);
  const agConn   = connect(AG_MONGODB_URI, AG_MONGO_DATABASE);

  // AUTH
  const UserSchema = new mongoose.Schema({
    userName: { type: String, unique: true },
    status:   { type: String },
    groupId:  { type: mongoose.Schema.Types.ObjectId }
  }, { versionKey: false });
  const AuthUser = authConn.model('User', UserSchema, 'users');

  // BANK
  const BankSchema = new mongoose.Schema({
    name:  { type: String, required: true, unique: true },
    code:  { type: String, required: true, unique: true },
    status:{ type: String, enum: ['active','inactive'], default: 'active' }
  }, { timestamps: true, versionKey: false });
  const Bank = bankConn.model('Bank', BankSchema, 'banks');

  // BANK-CORRESPONDENT (String para compatibilidade entre serviços)
  const bcStatuses = ['created','active','inactive'];
  const BankCorrespondentSchema = new mongoose.Schema({
    name:         { type: String, required: true, unique: true },
    code:         { type: String, required: true, unique: true },
    address:      { type: String },
    contactEmail: { type: String },
    contactPhone: { type: String },
    bankId:       { type: String, required: true },
    ownerAuthId:  { type: String, required: true },
    status:       { type: String, enum: bcStatuses, default: 'created' }
  }, { timestamps: true, versionKey: false });
  const BankCorrespondent = bcConn.model('BankCorrespondent', BankCorrespondentSchema, 'bankcorrespondents');

  // REAL-ESTATE
  const AddressSchema = new mongoose.Schema({
    street: { type: String, required: true },
    number: { type: String },
    complement: { type: String },
    city: { type: String, required: true },
    state:{ type: String, required: true },
    zip:  { type: String },
  }, { _id: false });

  const reStatuses = ['created','active','inactive'];
  const RealEstateSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    cnpj: { type: String, required: true, unique: true },
    email:{ type: String },
    phone:{ type: String },
    address: { type: AddressSchema, required: true },
    bankCorrespondentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BankCorrespondent' }],
    ownerAuthId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: reStatuses, default: 'created' }
  }, { timestamps: true, versionKey: false });
  const RealEstate = reConn.model('RealEstate', RealEstateSchema, 'realestates');

  // AGENT
  const agentStatuses = ['created','active','inactive'];
  const AgentSchema = new mongoose.Schema({
    name:          { type: String, required: true },
    email:         { type: String, required: true, unique: true },
    phoneNumber:   { type: String },
    licenseNumber: { type: String, required: true, unique: true },
    ownerAuthId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    realEstateIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'RealEstate' }],
    status:        { type: String, enum: agentStatuses, default: 'created', required: true }
  }, { timestamps: true, versionKey: false });
  const Agent = agConn.model('Agent', AgentSchema, 'agents');

  const getAuthUserId = async (userName) => {
    const u = await AuthUser.findOne({ userName, status: 'active' }).select('_id').lean();
    if (!u) throw new Error(`User "${userName}" não encontrado no AUTH`);
    return u._id;
  };

const upsertOne = async (model, filter, doc) =>
  (await model.findOneAndUpdate(filter, { $set: doc }, { new: true, upsert: true })).toObject();

  try {
    // Owners no AUTH
    const owner = {
      'bank-correspondent-caixa':     await getAuthUserId('bank-correspondent-caixa'),
      'bank-correspondent-santander': await getAuthUserId('bank-correspondent-santander'),
      'real-estate-caixa':            await getAuthUserId('real-estate-caixa'),
      'real-estate-santander':        await getAuthUserId('real-estate-santander'),
      'agent-caixa':                  await getAuthUserId('agent-caixa'),
      'agent-santander':              await getAuthUserId('agent-santander'),
    };

    // BANKS
    const bankCaixa = await upsertOne(Bank, { name: 'bank-caixa' }, { name: 'bank-caixa', code: '104', status: 'active' });
    const bankSant  = await upsertOne(Bank, { name: 'bank-santander' }, { name: 'bank-santander', code: '033', status: 'active' });

    // BANK-CORRESPONDENTS
    const bccx = await upsertOne(BankCorrespondent, { name: 'bank-correspondent-caixa' }, {
      name: 'bank-correspondent-caixa',
      code: 'CCA-CAIXA',
      bankId: String(bankCaixa._id),
      ownerAuthId: String(owner['bank-correspondent-caixa']),
      address: 'Av. Exemplo, 100',
      contactEmail: 'contato@ccaixa.local',
      contactPhone: '(11) 1111-1111',
      status: 'active'
    });
    const bcsd = await upsertOne(BankCorrespondent, { name: 'bank-correspondent-santander' }, {
      name: 'bank-correspondent-santander',
      code: 'CCA-SANTANDER',
      bankId: String(bankSant._id),
      ownerAuthId: String(owner['bank-correspondent-santander']),
      address: 'Rua Modelo, 200',
      contactEmail: 'contato@csantander.local',
      contactPhone: '(11) 2222-2222',
      status: 'active'
    });

    // REAL-ESTATES
    const reCx = await upsertOne(RealEstate, { name: 'real-estate-caixa' }, {
      name: 'real-estate-caixa',
      cnpj: '11.111.111/0001-91',
      email: 're.caixa@exemplo.local',
      phone: '(11) 3333-3333',
      address: { street: 'Rua Alfa', number: '10', city: 'São Paulo', state: 'SP', zip: '01000-000' },
      bankCorrespondentIds: [bccx._id],
      ownerAuthId: owner['real-estate-caixa'],
      status: 'active'
    });
    const reSd = await upsertOne(RealEstate, { name: 'real-estate-santander' }, {
      name: 'real-estate-santander',
      cnpj: '22.222.222/0001-09',
      email: 're.santander@exemplo.local',
      phone: '(11) 4444-4444',
      address: { street: 'Av. Beta', number: '20', city: 'São Paulo', state: 'SP', zip: '02000-000' },
      bankCorrespondentIds: [bcsd._id],
      ownerAuthId: owner['real-estate-santander'],
      status: 'active'
    });

    // AGENTS
    await upsertOne(Agent, { email: 'agent.caixa@exemplo.local' }, {
      name: 'agent-caixa',
      email: 'agent.caixa@exemplo.local',
      phoneNumber: '555193430091',
      licenseNumber: 'LIC-CAIXA-001',
      ownerAuthId: owner['agent-caixa'],
      realEstateIds: [reCx._id],
      status: 'active'
    });
    await upsertOne(Agent, { email: 'agent.santander@exemplo.local' }, {
      name: 'agent-santander',
      email: 'agent.santander@exemplo.local',
      phoneNumber: '(11) 6666-6666',
      licenseNumber: 'LIC-SANT-001',
      ownerAuthId: owner['agent-santander'],
      realEstateIds: [reSd._id],
      status: 'active'
    });
  } finally {
    await Promise.allSettled([
      authConn.close(), bankConn.close(), bcConn.close(), reConn.close(), agConn.close()
    ]);
  }
}
