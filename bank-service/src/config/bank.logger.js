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
    isProd ? format.json() : devFormat
  ),
  transports: [new transports.Console()],
});

export default logger;
