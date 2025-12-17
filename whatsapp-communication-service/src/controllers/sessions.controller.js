import {
  createSessionService,
  deleteSessionService,
  getSessionStatus as getStatusSvc,
  getLastQrDataUrl,
  normalizeMsisdn
} from '../services/session.service.js';
import logger from '../config/logger.js';

export const createSession = async (req, res) => {
  try {
    const raw = req.body?.whatsappPhoneNumber || req.body?.phone || req.body?.msisdn;
    const inboundJid = req.body?.whatsappJid || req.body?.jid;
    const msisdn = normalizeMsisdn(raw);
    if (!msisdn) return res.status(400).json({ error: 'whatsappPhoneNumber inválido' });

    // Se um JID foi fornecido, força o fluxo de identificação por JID no primeiro inbound
    if (inboundJid && typeof inboundJid === 'string') {
      process.env.TEST_FORCE_JID = inboundJid.trim();
    }

    const out = await createSessionService(msisdn);

    if (out?.status === 'already_connected') {
      return res.json({ status: 'connected', msisdn });
    }
    if (out?.status === 'busy') {
      return res.json({ status: 'pending', msisdn });
    }
    if (out?.qrCode) {
      return res.json({ status: 'qr', msisdn, qr_png_data_url: out.qrCode, attempts: out.attempts });
    }
    return res.status(202).json({ status: 'pending', msisdn, forcedJid: process.env.TEST_FORCE_JID || undefined });
  } catch (e) {
    logger.error({ err: e }, 'Falha ao registrar sessão');
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
};

export const deleteSession = async (req, res) => {
  try {
    const msisdn = normalizeMsisdn(req.params.whatsappPhoneNumber);
    if (!msisdn) return res.status(400).json({ error: 'msisdn inválido' });
    const out = await deleteSessionService(msisdn);
    return res.json({ status: 'deleted', ...out });
  } catch (e) {
    logger.error({ err: e }, 'Falha ao excluir sessão');
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
};

export const deleteAllSessions = async (_req, res) => {
  try {
    const out = await deleteSessionService();
    return res.json({ status: 'deleted_all', ...out });
  } catch (e) {
    logger.error({ err: e }, 'Falha ao excluir todas as sessões');
    res.status(500).json({ error: 'internal_error', detail: String(e?.message || e) });
  }
};

export const getStatus = async (req, res) => {
  try {
    const msisdn = normalizeMsisdn(req.params.whatsappPhoneNumber);
    if (!msisdn) return res.status(400).json({ error: 'msisdn inválido' });
    const st = await getStatusSvc(msisdn);
    return res.json({ msisdn, ...st });
  } catch (e) {
    logger.error({ err: e }, 'Falha ao obter status');
    res.status(500).json({ error: 'internal_error' });
  }
};

export const getQr = async (req, res) => {
  try {
    const msisdn = normalizeMsisdn(req.params.whatsappPhoneNumber);
    if (!msisdn) return res.status(400).json({ error: 'msisdn inválido' });
    const q = getLastQrDataUrl(msisdn);
    if (!q) return res.status(404).json({ error: 'qr_unavailable' });
    return res.json({ msisdn, qr_png_data_url: q.dataUrl, attempts: q.attempts, updatedAt: q.updatedAt, expiresAt: q.expiresAt });
  } catch (e) {
    logger.error({ err: e }, 'Falha ao obter QR');
    res.status(500).json({ error: 'internal_error' });
  }
};
