// src/services/awsS3.service.js

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import logger from '../config/caixaSimulator.logger.js';
import config from '../config/caixaSimulator.config.js';

const REGION = config.aws.region;
const BUCKET = config.aws.s3BucketName;

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  logger.warn('[S3] AWS_ACCESS_KEY_ID ou AWS_SECRET_ACCESS_KEY não configurados');
}
if (!REGION || !BUCKET) {
  logger.warn('[S3] AWS_REGION ou AWS_S3_BUCKET não configurados');
}

/**
 * Retorna um cliente S3 autenticado.
 * @returns {S3Client}
 */
function getS3Client() {
  if (!REGION) throw new Error('[S3] AWS_REGION ausente');
  return new S3Client({ region: REGION });
}

/**
 * Faz upload de um arquivo local para o S3.
 *
 * @param {string} localFilePath - Caminho absoluto do arquivo
 * @param {string} key           - Chave (nome) sob a qual o arquivo será salvo no bucket
 * @param {string} contentType   - Tipo MIME do arquivo
 * @returns {Promise<string>}    - URL pública (ou chave) do objeto no S3
 */
export async function uploadFileToS3(localFilePath, key, contentType) {
  logger.info(`[S3] Preparando upload: ${path.basename(localFilePath)} → s3://${BUCKET}/${key}`);
  if (!fs.existsSync(localFilePath)) {
    const msg = `[S3] Arquivo não encontrado em ${localFilePath}`;
    logger.error(msg);
    throw new Error(msg);
  }

  const fileStream = fs.createReadStream(localFilePath);
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: contentType //,
    //ACL: 'public-read'    // ou outra política de acesso
  });

  try {
    await client.send(command);
    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${encodeURIComponent(key)}`;
    return url;
  } catch (err) {
    logger.error('[S3] Erro no upload:', err);
    throw new Error(`Falha ao enviar arquivo para o S3: ${err.message}`);
  }
}
