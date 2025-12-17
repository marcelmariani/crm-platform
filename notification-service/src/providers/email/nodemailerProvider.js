// D:\SmartIASystems\notification-service\src\providers\email\nodemailerProvider.js
import nodemailer from 'nodemailer';

const SMTP_HOST   = process.env.SMTP_HOST;
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER   = process.env.SMTP_USER;
const SMTP_PASS   = process.env.SMTP_PASS;
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true'; // true = 465 SSL, false = 587 STARTTLS
const MAIL_FROM   = process.env.MAIL_FROM || 'no-reply@smartia.local';

// Opcional para ambiente com certificado SMTP self-signed (apenas dev):
const SMTP_TLS_REJECT_UNAUTHORIZED = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true').toLowerCase() === 'true';

let transporter;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_HOST) throw new Error('SMTP_HOST não configurado');

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    tls: SMTP_TLS_REJECT_UNAUTHORIZED ? undefined : { rejectUnauthorized: false },
  });

  return transporter;
}

export async function verifySmtp() {
  const t = getTransporter();
  await t.verify();
}

export async function sendEmail({ to, subject, text, html, cc, bcc, headers }) {
  const t = getTransporter();
  const toList = Array.isArray(to) ? to : (to ? [to] : []);
  if (!toList.length) throw new Error('Destinatário ausente (to)');
  return t.sendMail({ from: MAIL_FROM, to: toList, cc, bcc, subject, text, html, headers });
}
