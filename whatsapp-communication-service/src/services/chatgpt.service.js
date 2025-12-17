import logger from "../config/logger.js";

const DEFAULT_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const ENDPOINT = `${DEFAULT_BASE_URL.replace(/\/$/,'')}/chat/completions`;

function asMessages({ messages, userText, systemPrompt }) {
  if (Array.isArray(messages) && messages.length) return messages;
  const arr = [];
  if (systemPrompt) arr.push({ role: 'system', content: systemPrompt });
  arr.push({ role: 'user', content: String(userText ?? '').trim() });
  return arr;
}

function buildBody({ messages, model, temperature }) {
  const body = { model: model || process.env.OPENAI_MODEL || 'gpt-5', messages };
  const t = process.env.OPENAI_TEMPERATURE;
  const temp = temperature ?? (t === undefined || t === '' ? undefined : Number(t));
  if (Number.isFinite(temp)) body.temperature = temp;
  return body;
}

async function callOpenAI({ apiKey, body }) {
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  logger.info?.("[OpenAI] chamada", {
    model: body?.model,
    hasTemp: 'temperature' in body,
    latencyMs: Date.now() - start,
    ok: res.ok,
    status: res.status
  });
  return res;
}

/**
 * askChatGPT(options)
 * options:
 *   - messages: [{role, content}]  OU
 *   - userText, systemPrompt
 *   - model, apiKey
 */
export async function askChatGPT(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY ausente');

  let body = buildBody({
    messages: asMessages(options),
    model: options.model
  });

  let res = await callOpenAI({ apiKey, body });

  // Corrige temperatura inválida caso a API rejeite
  if (!res.ok) {
    let txt;
    try { txt = await res.text(); } catch { txt = ''; }
    try {
      const parsed = JSON.parse(txt);
      const code = parsed?.error?.code;
      const param = parsed?.error?.param;

      logger.error("[OpenAI] erro", {
        status: res.status,
        code, param,
        bodySnippet: txt?.slice(0, 600)
      });

      if (res.status === 400 && code === 'unsupported_value' && param === 'temperature') {
        delete body.temperature;
        res = await callOpenAI({ apiKey, body });
      } else {
        throw new Error(`OpenAI error ${res.status}: ${txt}`);
      }
    } catch {
      throw new Error(`OpenAI error ${res.status}: ${txt}`);
    }
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  return content || 'Sem resposta da IA.';
}
