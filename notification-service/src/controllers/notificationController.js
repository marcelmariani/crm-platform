import Notification from '../models/notificationModel.js';
import logger from '../config/logger.js';

function buildScopeFilter(req) {
  const isAdmin = req.access?.isAdmin === true;
  const scope = req.grant?.scope || 'own';
  if (isAdmin || scope === 'all') return {};

  const sub = String(req.user?.sub || '');
  const group = String(req.user?.group || '');
  const reIds = (req.scope?.realEstateIds || []).map(String);
  const bcIds = [
    ...(req.scope?.ownerBcIds || []),
    ...(req.scope?.groupBcIds || []),
  ].map(String);

  const or = [
    { auditInformation: { $elemMatch: { createdByAuthId: sub } } },
  ];

  if (scope === 'org') {
    if (group) or.push({ auditInformation: { $elemMatch: { createdByGroupId: group } } });
    if (reIds.length) or.push({ auditInformation: { $elemMatch: { createdAtRealEstateId: { $in: reIds } } } });
    if (bcIds.length) or.push({ auditInformation: { $elemMatch: { createdAtBankCorrespondentId: { $in: bcIds } } } });
  }

  return { $or: or };
}

export const createNotification = async (req, res) => {
  const { event, payload } = req.body || {};
  if (!event || payload == null) {
    return res.status(400).json({ error: 'event e payload são obrigatórios' });
  }
  try {
    const audit = {
      createdByAuthId: String(req.user?.sub || ''),
      createdByUserName: req.user?.userName || '',
      createdByGroupId: String(req.user?.group || ''),
      createdAtRealEstateId: req.scope?.realEstateId || null,           // se disponível
      createdAtBankCorrespondentId: req.scope?.bankCorrespondentId || null, // se disponível
    };

    const doc = await Notification.create({
      event,
      payload,
      auditInformation: [audit],
    });

    logger.info('Notification created', { notificationId: doc._id, event });
    res.status(201).json(doc);
  } catch (error) {
    logger.error('Error creating notification', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

export const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, event } = req.query;
    const filter = { ...buildScopeFilter(req) };
    if (status) filter.status = String(status);
    if (event)  filter.event  = String(event);

    const pg = Math.max(parseInt(page, 10) || 1, 1);
    const lm = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const skip = (pg - 1) * lm;

    const [items, total] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lm).lean(),
      Notification.countDocuments(filter),
    ]);

    logger.info('Listed notifications', { count: items.length, total });
    res.json({ items, total, page: pg, limit: lm });
  } catch (error) {
    logger.error('Error listing notifications', { error: error.message });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const getNotificationById = async (req, res) => {
  try {
    const scopeFilter = buildScopeFilter(req);
    const filter = Object.keys(scopeFilter).length
      ? { _id: req.params.id, ...scopeFilter }
      : { _id: req.params.id };

    const doc = await Notification.findOne(filter).lean();
    if (!doc) {
      logger.warn('Notification not found or out of scope', { id: req.params.id });
      return res.status(404).json({ error: 'Notificação não encontrada' });
    }
    logger.info('Fetched notification', { notificationId: doc._id });
    res.json(doc);
  } catch (error) {
    logger.error('Error fetching notification', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const scopeFilter = buildScopeFilter(req);
    const filter = Object.keys(scopeFilter).length
      ? { _id: req.params.id, ...scopeFilter }
      : { _id: req.params.id };

    const deleted = await Notification.findOneAndDelete(filter).lean();
    if (!deleted) {
      logger.warn('Notification to delete not found or out of scope', { id: req.params.id });
      return res.status(404).json({ error: 'Notificação não encontrada' });
    }
    logger.info('Notification deleted', { notificationId: req.params.id });
    res.status(204).send();
  } catch (error) {
    logger.error('Error deleting notification', { error: error.message, id: req.params.id });
    res.status(500).json({ error: 'Erro interno' });
  }
};
