import Contact from '../models/contactModel.js';
import logger from '../config/logger.js';
import { z } from 'zod';
import { isValidCPF, isValidCNPJ, isValidPhoneNumber } from '../utils/validators.js';
import { presentContact } from '../mappers/contactPresenter.js';

const createSchema = z.object({
  documentNumber: z.string().min(1),
  phoneNumber: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  birthDate: z.coerce.date().optional(),
  monthlyIncome: z.coerce.number().optional()
});

// 'type' não é atualizável por PUT; controlado por qualification
const updateSchema = z.object({
  documentNumber: z.string().optional(),
  phoneNumber: z.string().optional(),
  name: z.string().optional(),
  email: z.string().email().optional(),
  birthDate: z.coerce.date().optional(),
  monthlyIncome: z.coerce.number().optional(),
  fiscalType: z.enum(['person', 'company']).optional()
}).strict();

function firstOrNull(arr) {
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

function buildScopeFilter(req) {
  const isAdmin = req.access?.isAdmin === true;
  const scope = req.grant?.scope || 'own';
  if (isAdmin || scope === 'all') return {};

  const sub = String(req.user?.sub || '');
  const group = String(req.user?.group || '');
  const agentIds = req.scope?.agentIds || [];
  const reIds = req.scope?.realEstateIds || [];
  const bcIds = [ ...(req.scope?.ownerBcIds || []), ...(req.scope?.groupBcIds || []) ];

  const or = [{ createdByAuthId: sub }];

  if (scope === 'org') {
    or.push({ createdByGroupId: group });
    if (agentIds.length) or.push({ createdAtAgentId: { $in: agentIds } });
    if (reIds.length) or.push({ createdAtRealEstateId: { $in: reIds } });
    if (bcIds.length) or.push({ createdAtBankCorrespondentId: { $in: bcIds } });
  }

  return { $or: or };
}

export const createContact = async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });
    }

    const scope = req.scope || {};
    const payload = {
      ...parsed.data,
      createdByAuthId: String(req.user?.sub || ''),
      createdByUserName: req.user?.userName || '',
      createdByGroupId: String(req.user?.group || ''),
      createdAtAgentId: firstOrNull(scope.agentIds) || null,
      createdAtRealEstateId: firstOrNull(scope.realEstateIds) || null,
      createdAtBankCorrespondentId: firstOrNull(scope.ownerBcIds) || firstOrNull(scope.groupBcIds) || null
    };

    const contact = await Contact.create(payload);
    logger.info('Contact created', {
      contactId: contact._id,
      createdByAuthId: payload.createdByAuthId,
      createdAtAgentId: payload.createdAtAgentId
    });
    res.status(201).json(presentContact(contact));
  } catch (error) {
    logger.error('Error creating contact', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

export const getContacts = async (req, res) => {
  try {
    const filter = buildScopeFilter(req);
    const page = Math.max(parseInt(req.query.page ?? '1', 10), 1);
    const limitReq = Math.max(parseInt(req.query.limit ?? '20', 10), 1);
    const limit = Math.min(limitReq, 100);
    const sort = req.query.sort ?? '-createdAt';

    const [rows, total] = await Promise.all([
      Contact.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
      Contact.countDocuments(filter)
    ]);

    res.json({
      page,
      limit,
      total,
      rows: rows.map(presentContact),
    });
  } catch (error) {
    logger.error('Error listing contacts', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const getContactById = async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const contact = await Contact.findOne(filter).lean();
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(presentContact(contact));
  } catch (error) {
    logger.error('Error fetching contact', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const getContactByDocumentNumber = async (req, res) => {
  try {
    const documentNumber = req.params.documentNumber;
    if (!documentNumber) {
      return res.status(400).json({ error: 'documentNumber é obrigatório' });
    }

    const filter = { documentNumber, ...buildScopeFilter(req) };
    const contact = await Contact.findOne(filter).lean();
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(presentContact(contact));
  } catch (error) {
    logger.error('Error fetching contact by documentNumber', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const updateContact = async (req, res) => {

  try {
    if (Object.prototype.hasOwnProperty.call(req.body, 'type')) {
      return res.status(400).json({ error: "Campo 'type' é controlado por /contacts/:id/qualification" });
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map(i => i.message).join(', ') });

    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const updated = await Contact.findOneAndUpdate(
      filter,
      parsed.data,
      { new: true, runValidators: true, context: {} }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Contato não encontrado' });
    res.json(presentContact(updated));
  } catch (error) {
    logger.error('Error updating contact', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

export const deleteContact = async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const deleted = await Contact.findOneAndDelete(filter).lean();
    if (!deleted) return res.status(404).json({ error: 'Contato não encontrado' });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting contact', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

/**
 * PATCH /contacts/:id/qualification
 * Converte 'lead' -> 'client' com validações.
 * Único ponto autorizado a setar { type: 'client' }.
 */
export const qualifyContact = async (req, res) => {
  try {
    const filter = { _id: req.params.id, ...buildScopeFilter(req) };
    const contact = await Contact.findOne(filter);
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    if (contact.type === 'client') return res.status(400).json({ error: 'Já é cliente' });

    const { name, birthDate, monthlyIncome, documentNumber, phoneNumber } = contact;
    if (!name || !birthDate || monthlyIncome == null || !documentNumber || !phoneNumber) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes para conversão' });
    }

    const cpfValid = isValidCPF(documentNumber);
    const cnpjValid = isValidCNPJ(documentNumber);
    if (!cpfValid && !cnpjValid) return res.status(400).json({ error: 'documentNumber inválido' });
    if (!isValidPhoneNumber(phoneNumber)) return res.status(400).json({ error: 'phoneNumber inválido' });

    // Libera e efetiva mudança para client
    contact.$locals = { ...(contact.$locals || {}), allowTypeToClient: true };
    contact.type = 'client';
    contact.fiscalType = cpfValid ? 'person' : 'company';
    await contact.save();

    logger.info('Lead convertido em cliente', { contactId: contact._id });

    // Retorna com status atual 'active' e histórico da transição
    return res.json(
      presentContact(contact, {
        actor: { authId: String(req.user?.sub || ''), userName: req.user?.userName || null },
        actionAt: new Date(),
      })
    );
  } catch (error) {
    logger.error('Erro ao qualificar contato', { error: error.message, contactId: req.params.id });
    res.status(500).json({ error: 'Erro interno' });
  }
};
