// src/config/config.js

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const env        = process.env.NODE_ENV || 'development';

// Carrega .env.development, .env.test, etc.
dotenv.config({
  path: path.resolve(__dirname, '../../', `.env.${env}`)
});

const config = {
  env,
  port:     Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI,
  mongoDB:  process.env.MONGO_DATABASE,
  
  // JWT / Auth
  jwt: {
    secret:         process.env.JWT_SECRET,
    expiresIn:      process.env.JWT_EXPIRES_IN,
    adminUsername:  process.env.JWT_ADMIN_USERNAME,
    adminPass:      process.env.JWT_ADMIN_PASS,
    serviceUrl:     process.env.JWT_SERVICE_URL,
    loginPath:      process.env.JWT_LOGIN_PATH,
  },

  // Grants
  grants: {
    checkMethod:        process.env.AUTH_GRANTS_CHECK_METHOD,
    checkPath:          process.env.AUTH_GRANTS_CHECK_PATH,
    queryGroupKey:      process.env.AUTH_GRANTS_QUERY_GROUP_KEY,
    queryResourceKey:   process.env.AUTH_GRANTS_QUERY_RESOURCE_KEY,
  },

  // Common
  logLevel: process.env.LOG_LEVEL || 'info',

  // Redis
  redis: {
    url:                      process.env.REDIS_URL,
    prefixCaixaSimulator:     process.env.REDIS_PREFIX_CAIXA_SIMULATOR,
    prefixSales:              process.env.REDIS_PREFIX_SALES,
    queueAttempts:            Number(process.env.REDIS_QUEUE_ATTEMPTS) || 3,
    queueBackoffMs:           Number(process.env.REDIS_QUEUE_BACKOFF_MS) || 1000,
    queueDlqContract:         process.env.REDIS_QUEUE_DLQ_CONTRACT,
    queueDlqProposal:         process.env.REDIS_QUEUE_DLQ_PROPOSAL,
    queueEnabled:             process.env.REDIS_QUEUE_ENABLED === 'true',
    queueNameCaixaSimulator:  process.env.REDIS_QUEUE_NAME_CAIXA_SIMULATOR,
    queueNameSales:           process.env.REDIS_QUEUE_NAME_SALES,
    workersSimultaneous:      Number(process.env.REDIS_WORKERS_SIMULTANEOUS) || 1,
  },

  // Email
  email: {
    mailFrom:                 process.env.MAIL_FROM,
    notificationsFallbackTo:  process.env.NOTIFICATIONS_FALLBACK_TO,
    smtpHost:                 process.env.SMTP_HOST,
    smtpPort:                 Number(process.env.SMTP_PORT) || 587,
    smtpUser:                 process.env.SMTP_USER,
    smtpPass:                 process.env.SMTP_PASS,
    smtpSecure:               process.env.SMTP_SECURE === 'true',
    smtpTlsRejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false',
  },

  // AWS
  aws: {
    region:       process.env.AWS_REGION_ || 'us-east-1',
    s3BucketName: process.env.AWS_S3_BUCKET_NAME,
  },

  // Puppeteer
  puppeteer: {
    devtools:         process.env.PUPPETEER_DEVTOOLS === 'true',
    headless:         process.env.PUPPETEER_HEADLESS !== 'false',
    keepOpenOnError:  process.env.PUPPETEER_KEEP_OPEN_ON_ERROR === 'true',
    keepOpenOnSuccess: process.env.PUPPETEER_KEEP_OPEN_ON_SUCCESS === 'true',
    slowmo:           Number(process.env.PUPPETEER_SLOWMO) || 0,
  },

  // OpenAI
  openai: {
    model:  process.env.OPENAI_MODEL,
    apiKey: process.env.OPENAI_API_KEY,
  },

  sslKeyPath:  process.env.SSL_KEY_PATH,
  sslCertPath: process.env.SSL_CERT_PATH,
};

export default config;
