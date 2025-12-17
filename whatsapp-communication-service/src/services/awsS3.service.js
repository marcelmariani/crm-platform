import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Buffer } from "buffer";
import logger from "../config/logger.js";
import config from "../config/config.js";

const region = process.env.AWS_REGION;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const bucketEnv = process.env.AWS_S3_BUCKET;

if (!region) {
  logger.warn("[AwsS3Service] AWS_REGION está ausente. S3 desabilitado.");
}
if (!accessKeyId || !secretAccessKey) {
  logger.warn("[AwsS3Service] Credenciais AWS S3 ausentes. S3 desabilitado.");
}

let s3Client = null;
if (region && accessKeyId && secretAccessKey) {
  s3Client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey }
  });
}

/** Converte um ReadableStream do S3 em Buffer */
async function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/**
 * Dado o URL completo de um objeto no S3, retorna um Data URI base64.
 * Se AWS_S3_BUCKET não estiver no .env, extrai o bucket do host da URL.
 */
export async function getBase64FromS3Url(fileUrl) {
  if (!s3Client) {
    throw new Error("S3 não está configurado. Configure AWS_REGION, AWS_ACCESS_KEY_ID e AWS_SECRET_ACCESS_KEY.");
  }
  
  const urlObj = new URL(fileUrl);
  const key = decodeURIComponent(urlObj.pathname.slice(1));

  const bucket = bucketEnv || urlObj.host.split(".s3.")[0];
  if (!bucket) {
    throw new Error(
      "Nome do bucket S3 não encontrado. Defina AWS_S3_BUCKET ou use URL no formato correto."
    );
  }

  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  const resp = await s3Client.send(cmd);
  const buffer = await streamToBuffer(resp.Body);
  const contentType = resp.ContentType || "application/octet-stream";
  const base64 = buffer.toString("base64");

  return { dataUrl: `data:${contentType};base64,${base64}`, contentType };
}

// **EXPORTS** para uso externo
export { s3Client, streamToBuffer };
