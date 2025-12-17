import { createLogger, format, transports } from 'winston';
import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';
import util from 'util';

const require = createRequire(import.meta.url);
const pkg = require(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json')
);

const logger = createLogger({
  level:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  defaultMeta: {
    service: pkg.name,
    env: process.env.NODE_ENV || 'development',
  },
  format: format.combine(
    format.timestamp(),
    process.env.NODE_ENV === 'production'
      ? format.json()
      : format.printf(({ timestamp, level, message, service, env, ...meta }) => {
          const metaKeys = Object.keys(meta);
          const metaStr = metaKeys.length
            ? util.inspect(meta, { depth: null, breakLength: Infinity })
            : '';
          return `${timestamp} [${service}/${env}] ${level.toUpperCase()}: ${message} ${metaStr}`;
        })
  ),
  transports: [new transports.Console()],
});

export default logger;
