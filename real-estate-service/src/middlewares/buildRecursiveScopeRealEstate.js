// src/middlewares/buildRecursiveScopeRealEstate.js
import axios from 'axios';
import https from 'https';
import logger from '../config/logger.js';        // ajuste se seu logger estiver em outro caminho
import config from '../config/config.js';        // expõe skipTlsVerify e, se quiser, a URL de serviço

function urlJoin(base, path) {
  const b = base.endsWith('/') ? base : base + '/';
  const p = path.startsWith('/') ? path.slice(1) : path;
  return new URL(p, b).toString().replace(/\/+$/, '');
}
function replaceVars(path, vars) {
  return path.replace(/:([A-Za-z_]\w*)/g, (_, k) => encodeURIComponent(vars[k] ?? ''));
}
function toArray(x) { return Array.isArray(x) ? x : x ? [x] : []; }
function asId(x) { return String(x?._id ?? x?.id ?? '').trim(); }

export default async function buildRecursiveScopeRealEstate(req, _res, next) {
  const scope = { groupId: req.user?.group ? String(req.user.group) : undefined };

  try {
    const token = (req.headers.authorization || '').trim();

    // URL do bank-correspondent-service padronizada com fallbacks
    const base =
      String(process.env.APP_APP_BANK_CORRESPONDENT_SERVICE_URL || '').trim() ||
      String(process.env.APP_BANK_CORRESPONDENT_SERVICE_URL || '').trim() ||
      String(process.env.BC_SERVICE_URL || '').trim() ||
      String(config.bankCorrespondentServiceUrl || '').trim();

    if (!base) {
      logger.debug('[scope] URL do bank-correspondent-service não configurada');
      req.scope = scope;
      return next();
    }

    const skipTls =
      String(process.env.SKIP_TLS_VERIFY ?? config.skipTlsVerify ?? '') === 'true' ||
      process.env.NODE_ENV === 'development';

    const httpsAgent = new https.Agent({ rejectUnauthorized: !skipTls });

    // Instância HTTP que propaga o Bearer do usuário
    const http = axios.create({
      baseURL: base,
      timeout: 10000,
      httpsAgent,
      headers: token ? { Authorization: token, Accept: 'application/json' } : { Accept: 'application/json' },
    });

    const owner = String(req.user?.sub || '');
    const group = String(req.user?.group || '');

    const ownerCandidates = [
      '/bank-correspondents/owner/:ownerAuthId',
      '/bank-correspondents/by-owner/:ownerAuthId',
      '/bank-correspondents?ownerAuthId=:ownerAuthId',
      '/bank-correspondents?ownerId=:ownerAuthId',
    ];
    const groupCandidates = [
      '/bank-correspondents/by-group/:groupId',
      '/bank-correspondents/group/:groupId',
      '/bank-correspondents?groupId=:groupId',
    ];

    const ownerIds = new Set();
    const groupIds = new Set();

    // ---- Busca por OWNER: só aceita itens com ownerAuthId === sub ----
    if (owner) {
      for (const p of ownerCandidates) {
        try {
          const path = p.includes('?')
            ? p.replace(':ownerAuthId', encodeURIComponent(owner))
            : replaceVars(p, { ownerAuthId: owner });
          const url = urlJoin(base, path);

          const { data } = await http.get(url);
          let added = 0;
          for (const it of toArray(data?.items ?? data)) {
            const id = asId(it);
            if (!id) continue;
            if (String(it?.ownerAuthId ?? '') !== owner) continue; // filtro crítico
            ownerIds.add(id);
            added++;
          }
          logger.debug('[scope] owner route %s → +%d ids (%d total)', path, added, ownerIds.size);
          if (added > 0) break; // primeira rota válida já basta
        } catch (e) {
          logger.debug('[scope] owner route falhou %s: %s', p, e?.message);
        }
      }
    } else {
      logger.debug('[scope] sem owner (req.user.sub) para montar escopo por owner');
    }

    // ---- Busca por GROUP: só aceita itens com groupId === req.user.group ----
    if (group) {
      for (const p of groupCandidates) {
        try {
          const path = p.includes('?')
            ? p.replace(':groupId', encodeURIComponent(group))
            : replaceVars(p, { groupId: group });
          const url = urlJoin(base, path);

          const { data } = await http.get(url);
          let added = 0;
          for (const it of toArray(data?.items ?? data)) {
            const id = asId(it);
            if (!id) continue;
            if (String(it?.groupId ?? '') !== group) continue; // evita “lista inteira”
            groupIds.add(id);
            added++;
          }
          logger.debug('[scope] group route %s → +%d ids (%d total)', path, added, groupIds.size);
        } catch (e) {
          logger.debug('[scope] group route falhou %s: %s', p, e?.message);
        }
      }
    } else {
      logger.debug('[scope] sem group (req.user.group) para montar escopo por group');
    }

    // Autorização usa APENAS ownerIds; groupIds é informativo
    scope.ownerBankCorrespondentIds = Array.from(ownerIds);
    scope.groupBankCorrespondentIds = Array.from(groupIds);

    // Compat legado: não usar união para auth
    scope.bankCorrespondentIds = [];
    delete scope.bankCorrespondentId;

  } catch (err) {
    logger.debug('[scope] erro inesperado: %s', err?.message);
  }

  req.scope = scope;
  return next();
}
