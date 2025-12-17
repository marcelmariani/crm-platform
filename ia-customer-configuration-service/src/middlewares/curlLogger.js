import logger from '../config/customerConfiguration.logger.js';

const SHOULD_LOG = (process.env.LOG_INCOMING_CURL || 'true').toLowerCase() === 'true';
const REDACT = (process.env.CURL_REDACT_AUTH || 'true').toLowerCase() === 'true';

function redactToken(h) {
  if (!h || !REDACT) return h || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  if (!m) return h;
  const t = m[1];
  return `Bearer ${t.length > 16 ? `${t.slice(0,6)}...${t.slice(-6)}` : '<redacted>'}`;
}

function buildCurl(req) {
  const method = req.method.toUpperCase();
  const host = req.get('host');
  const scheme = req.protocol || (req.secure ? 'https' : 'http');
  const url = `${scheme}://${host}${req.originalUrl}`;
  const lines = [`curl --location '${url}'`];

  // headers úteis
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host','content-length','connection'].includes(k)) continue;
    lines.push(`--header '${k}: ${k === 'authorization' ? redactToken(v) : v}'`);
  }

  if (['POST','PUT','PATCH'].includes(method) && req.is('application/json') && req.body) {
    lines.push(`--data '${JSON.stringify(req.body)}'`);
  }
  return lines.join(' \\\n');
}

export function curlLogger(req, _res, next) {
  if (!SHOULD_LOG) return next();
  try {
    const curl = buildCurl(req);
    logger.info(`incoming.request.curl\n${curl}`);
  } catch {}
  next();
}
