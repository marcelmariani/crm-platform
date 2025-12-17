// src/config/logger.js
import { createLogger, format, transports } from 'winston';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';
import util from 'util';

const require = createRequire(import.meta.url);
const pkg = require(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'));

const isProd = process.env.NODE_ENV === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL || (isProd ? 'info' : 'debug');

const devFormat = format.printf(info => {
  const { timestamp, level } = info;
  const service = info.service || pkg.name;
  const env = info.env || (process.env.NODE_ENV || 'development');

  // Mensagem amigável para Error/objeto
  let msg = info.stack || info.message;
  if (typeof msg === 'object') {
    msg = msg?.stack || msg?.message || util.inspect(msg, { depth: null, breakLength: Infinity });
  }

  // Meta sem campos padrão
  const meta = { ...info };
  ['timestamp','level','message','stack','service','env'].forEach(k => delete meta[k]);
  const metaStr = Object.keys(meta).length
    ? ' ' + util.inspect(meta, { depth: null, breakLength: Infinity })
    : '';

  return `${timestamp} [${service}/${env}] ${level.toUpperCase()}: ${msg}${metaStr}`;
});

const logger = createLogger({
  level: LOG_LEVEL,
  defaultMeta: {
    service: pkg.name,
    env: process.env.NODE_ENV || 'development',
  },
  format: format.combine(
    format.errors({ stack: true }), // captura stack ao logar Error
    format.timestamp(),
    devFormat
  ),
  transports: [new transports.Console()],
});

export default logger;

/*import { createLogger, format, transports } from "winston";

function safeStringify(obj, { maxDepth = 5, maxLen = 12000 } = {}) {
  const seen = new WeakSet();
  const skipKeys = new Set([
    "socket","agent","request","response","req","res","stream",
    "client","connection","config","_httpMessage","_socket","_owner"
  ]);

  const prune = (value, depth) => {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    if (depth <= 0) return "[Object]";
    seen.add(value);

    if (Array.isArray(value)) return value.slice(0, 50).map(v => prune(v, depth - 1));

    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (skipKeys.has(k)) { out[k] = "[Skipped]"; continue; }
      if (typeof v === "function") { out[k] = "[Function]"; continue; }
      out[k] = prune(v, depth - 1);
    }
    return out;
  };

  try {
    const s = JSON.stringify(prune(obj, maxDepth));
    return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
  } catch {
    return "[Unserializable]";
  }
}

const loggerInstance = createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.splat(),
    format.metadata({ fillExcept: ["timestamp", "level", "message"] }),
    format.printf(info => {
      const base = `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`;
      const meta = info.metadata && Object.keys(info.metadata).length
        ? " " + safeStringify(info.metadata)
        : "";
      return base + meta;
    })
  ),
  transports: [new transports.Console()]
});

export const logger = loggerInstance;
export default loggerInstance;
*/