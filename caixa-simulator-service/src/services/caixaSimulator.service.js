// src/services/caixaSimulatorService.js
import axios from 'axios';
import https from 'https';
import dns from 'dns';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { Types } from 'mongoose';
import seletores from '../config/caixaSimulator.seletores.js';
import logger from '../config/caixaSimulator.logger.js';
import config from '../config/caixaSimulator.config.js';
import { normalizeString } from '../utils/caixaSimulator.normalize.js';
import { fileURLToPath } from 'url';
import { uploadFileToS3 } from './caixaSimulatorAwsS3.service.js';
import Simulacao from '../models/caixaSimulator.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const __env      = process.env.NODE_ENV || 'development';

// Reduz ruído de logs do Chromium relacionado a AT-SPI/DBus
if (!process.env.NO_AT_BRIDGE) process.env.NO_AT_BRIDGE = '1';

const KEEP_OPEN_ON_ERROR   = process.env.PUPPETEER_KEEP_OPEN_ON_ERROR === 'true';
const KEEP_OPEN_ON_SUCCESS = process.env.PUPPETEER_KEEP_OPEN_ON_SUCCESS === 'true';
const DEVTOOLS             = process.env.PUPPETEER_DEVTOOLS === 'false';
const SLOWMO               = Number(process.env.PUPPETEER_SLOWMO || 0) || 0;

const httpsAgentCb = new https.Agent({ rejectUnauthorized: false });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let page;

/* --------------------------------------------------------
 * HTTP helpers / callbacks
 * ------------------------------------------------------ */
const doFetch = async (...args) => {
  if (typeof fetch !== 'undefined') return fetch(...args);
  const { default: fetchPolyfill } = await import('node-fetch');
  return fetchPolyfill(...args);
};

const isHttpUrl = (u) => {
  try { const p = new URL(String(u)); return p.protocol === 'http:' || p.protocol === 'https:'; }
  catch { return false; }
};

// Monta um comando cURL reproduzível (Linux) para facilitar debug
function buildCurlCommand(url, payload) {
  const json = JSON.stringify(payload ?? {});
  // escape seguro para single-quotes no bash: ' -> '\''
  const esc = (s) => String(s).replace(/'/g, "'\\''");
  return `curl -sS -X POST -k '${esc(url)}' -H 'Content-Type: application/json' -m 10 --data-raw '${esc(json)}'`;
}

async function notifyCallback(url, payload) {
  if (!isHttpUrl(url)) return;
  try {
    const { status } = await axios.post(url, payload, { httpsAgent: httpsAgentCb, timeout: 10000 });
    logger.info(`[callback] url=${url} status=${status}`);
  } catch (e) {
    const res = e?.response;
    const status = res?.status;
    let body;
    try {
      const data = res?.data;
      body = typeof data === 'string' ? data.slice(0, 800) : JSON.stringify(data)?.slice(0, 800);
    } catch {}
    const curlCmd = buildCurlCommand(url, payload);
    logger.warn(`[callback] falha url=${url} status=${status ?? 'n/a'} msg=${e.message}${body ? ` body=${body}` : ''} curl=${curlCmd}`);
  }
}

/* --------------------------------------------------------
 * Admin auth (cache)
 * ------------------------------------------------------ */
const AUTH_URL = `${process.env.JWT_SERVICE_URL || ''}${process.env.JWT_LOGIN_PATH || ''}`;
const AUTH_USER = (process.env.JWT_ADMIN_USERNAME || '').trim();
const AUTH_PASS = (process.env.JWT_ADMIN_PASS || '').trim();

let __adminJwtCache = { token: null, expMs: 0 };
function decodeJwtExpMs(jwt) {
  try {
    const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
    if (json?.exp) return json.exp * 1000;
  } catch {}
  return 0;
}

/* --------------------------------------------------------
 * Typing utilities (anti-duplicação)
 * ------------------------------------------------------ */
const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '');
const lastNDigits = (v, n) => onlyDigits(v).slice(-n);
const centsToDigits = (cents) => (Number.isFinite(cents) ? String(Math.trunc(cents)) : onlyDigits(cents));

const dateToDigits = (d) => {
  const s = String(d ?? '').trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s.replace(/\D/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y,m,dd] = s.split('-'); return `${dd}${m}${y}`; }
  return onlyDigits(s);
};

/** Limpa o campo por DOM (value='') + eventos, depois digita os dígitos */
async function clearByDomAndType(selector, rawDigits) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });

  const digits = String(rawDigits ?? '').replace(/\D/g, '');

  // desligar/autocomplete e limpar duro via DOM
  await page.$eval(selector, (el) => {
    el.setAttribute('autocomplete', 'off');
    el.autocomplete = 'off';
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur?.();
  });

  // tenta focar para ativar máscaras se necessário
  try { await page.click(selector, { clickCount: 1 }); } catch {}

  if (!digits) return;

  // escreve o valor diretamente no DOM e dispara eventos (evita duplicação causada por mask plugins)
  await page.$eval(selector, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur?.();
  }, digits);

  await sleep(120);
}

/** Seta dinheiro (campo com máscara) garantindo limpeza e blur */
async function setMoney(selector, digits) {
  const d = String(digits ?? '').replace(/\D/g, '');
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });

  // use a mesma estratégia: setar value direto e disparar events
  await page.$eval(selector, (el) => {
    el.setAttribute('autocomplete', 'off');
    el.autocomplete = 'off';
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });

  if (!d) return;

  await page.$eval(selector, (el, val) => {
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur?.();
  }, d);

  await sleep(120);
}

/** Formata telefone para o padrão esperado: (xx)xxxx-xxxx */
const formatPhoneForInput = (phone) => {
  const digits = onlyDigits(phone);
  if (digits.length < 10) return digits;
  // Pega últimos 10 dígitos e formata como (xx)xxxx-xxxx
  const last10 = digits.slice(-10);
  return `(${last10.slice(0, 2)})${last10.slice(2, 6)}-${last10.slice(6)}`;
};

/** Helpers para mascarar dados sensíveis em logs */
function maskCpfCnpj(v) {
  const d = onlyDigits(v);
  if (!d) return '';
  const keep = 3;
  const hidden = d.slice(0, Math.max(0, d.length - keep)).replace(/./g, '*');
  return hidden + d.slice(-keep);
}

function maskPhone(v) {
  const d = onlyDigits(v);
  if (!d) return '';
  const keep = 4;
  const hidden = d.slice(0, Math.max(0, d.length - keep)).replace(/./g, '*');
  return hidden + d.slice(-keep);
}

/** Combo “select escondido + inputid” */
async function setComboboxValue(selectId, valueOrText) {
  return await page.evaluate((id, wanted) => {
    const norm = s => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim().toLowerCase();
    const sel = document.getElementById(id);
    if (!sel) return false;
    const opts = Array.from(sel.options ?? []);
    let opt = opts.find(o => String(o.value) === String(wanted));
    if (!opt) opt = opts.find(o => norm(o.text) === norm(wanted));
    if (!opt) return false;

    sel.value = String(opt.value);

    const inputId = sel.getAttribute('inputid');
    const inp = inputId && document.getElementById(inputId);
    if (inp) {
      inp.value = opt.text;
      inp.dispatchEvent(new Event('input',  { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.blur?.();
    }
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    if (id === 'tipoImovel' && typeof window.simuladorInternet?.carregarCategoriaImovel === 'function') {
      window.simuladorInternet.carregarCategoriaImovel(sel.value);
    }
    return true;
  }, selectId, valueOrText);
}

/* --------------------------------------------------------
 * Callback list (admin-config + env + payload)
 * ------------------------------------------------------ */
async function getAdminCallbacksFromHttp() {
  const endpoint = (process.env.ADMIN_CONFIGURATION_HTTP || '').trim();
  if (!endpoint) return [];
  try {
    const resp = await doFetch(endpoint, {
      headers: { authorization: `Bearer ${process.env.ADMIN_CONFIGURATION_TOKEN || ''}` }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const questions = Array.isArray(data?.questions) ? data.questions
      : Array.isArray(data) ? data
      : Array.isArray(data?.result?.questions) ? data.result.questions
      : [];
    return questions
      .filter(q => String(q?.type || '').toLowerCase() === 'callback')
      .map(q => q?.valueAutocomplete)
      .filter(isHttpUrl);
  } catch {
    return [];
  }
}

async function resolveCallbackTargets(/* dados */) {
  // Política: usar SOMENTE a variável APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL.
  // Suporta múltiplas URLs separadas por vírgula.
  const envList = (process.env.APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL || '')
    .split(',')
    .map(s => s.trim())
    .filter(isHttpUrl);

  const uniq = Array.from(new Set(envList));
  if (!uniq.length) {
    logger.warn('[callback] nenhuma URL válida em APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL; callbacks serão ignorados');
  }
  return uniq;
}

export async function notifyCallbacks(dados) {
  const urls = await resolveCallbackTargets(dados);
  if (!urls.length) return;
  logger.info(`[callback] destinos (from env): ${urls.join(', ')}`);

  // Filtra URLs que não resolvem para IPv4 no ambiente atual (bridge IPv4)
  const resolvable = [];
  const skipped = [];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname;
      const r = await dns.promises.lookup(host, { family: 4 });
      if (r && r.address) resolvable.push(u); else skipped.push(u);
    } catch {
      skipped.push(u);
    }
  }
  if (skipped.length) logger.warn(`[callback] ignorando URLs sem A/IPv4: ${skipped.join(', ')}`);
  if (!resolvable.length) return;

  const httpsAgent = new https.Agent({ rejectUnauthorized: false });
  const body = {
    simulationId: String(dados.simulationId || ''),
    status: dados.status,
    driveFileId: dados.driveFileId || null,
    dadosOutput: dados.dadosOutput || {},
    dadosInput: dados.dadosInput || {},
    finishedAt: dados.finishedAt || new Date().toISOString(),
  };

  await Promise.allSettled(
    resolvable.map(async (url) => {
      try {
        const { status } = await axios.post(url, body, { httpsAgent, timeout: 10000 });
        logger.info(`[callback] POST ${url} -> ${status}`);
      } catch (e) {
        logger.warn(`[callback] Falha em ${url}: ${e?.message || e}`);
      }
    })
  );
}

/* --------------------------------------------------------
 * Mapeamentos simples
 * ------------------------------------------------------ */
const tipoImovelMap = { R:'1', C:'2', Rural:'5', '1':'1','2':'2','5':'5' };
const finalidadeMap = {
  C: 'Aquisição de Imóvel Novo',
  U: 'Aquisição de Imóvel Usado',
  N: 'Aquisição de Imóvel Novo',
  Reforma: 'Construção/Ampliação/Reforma',
};

const RAW_HEADLESS = (process.env.PUPPETEER_HEADLESS ?? 'new').toString().toLowerCase();
const HEADLESS = RAW_HEADLESS === 'new' ? 'new' : ['1','true','yes','y'].includes(RAW_HEADLESS);
const NO_SANDBOX = ['1','true','yes','y'].includes((process.env.PUPPETEER_NO_SANDBOX ?? '').toString().toLowerCase());
const INCLUDE_COBERTURA = ['1','true','yes','y'].includes((process.env.INCLUDE_COBERTURA ?? '').toString().toLowerCase());

/* ========================================================
 * ENTRADA PRINCIPAL
 * ====================================================== */
export async function caixaSimulator(dados) {
  
  const idCaixaSimulator = new Types.ObjectId();

  logger.info(`[${idCaixaSimulator}] Iniciando simulação`);

  // Log de resumo de entrada (sem expor PII)
  try {
    logger.debug(
      `[${idCaixaSimulator}] Entrada: uf=${dados.uf} cidade="${dados.cidade}" ` +
      `tipoPessoa=${dados.tipoPessoa} tipoFinanciamento=${dados.tipoFinanciamento} ` +
      `finalidade="${dados.finalidade}" valorImovel=${dados.valorImovel} renda=${dados.renda} ` +
      `linhaCredito="${dados.linhaCredito}" cpf=${maskCpfCnpj(dados.cpf)} tel=${maskPhone(dados.telefone)}`
    );
  } catch {}

  const t0 = Date.now();
  const stepInfo = (title, details) => logger.info(`[${idCaixaSimulator}] ${title}${details ? ' | ' + details : ''}`);
  const stepDebug = (title, details) => logger.debug(`[${idCaixaSimulator}] ${title}${details ? ' | ' + details : ''}`);

  // Log inicial: destinos de callback vindos exclusivamente da env
  try {
    const startTargets = await resolveCallbackTargets(dados);
    if (startTargets?.length) {
      logger.info(`[callback] destinos (from env) [start]: ${startTargets.join(', ')}`);
    } else {
      logger.warn('[callback] nenhum destino resolvido a partir de APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL [start]');
    }
  } catch (e) {
    logger.warn(`[callback] falha ao resolver destinos no início: ${e.message}`);
  }

  const screenshotsDir = path.join(__dirname, '../../screenshots');
  if (fs.existsSync(screenshotsDir)) {
    for (const f of fs.readdirSync(screenshotsDir)) {
      try { fs.unlinkSync(path.join(screenshotsDir, f)); } catch {}
    }
  } else {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const args = [
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-zygote',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    // Evita autodetecção/uso de proxy (elimina avisos do V8 proxy resolver)
    '--no-proxy-server',
    '--proxy-bypass-list=*'
  ];
  if (NO_SANDBOX) args.unshift('--no-sandbox', '--disable-setuid-sandbox');

  stepInfo('Lançando navegador Puppeteer');
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    devtools: DEVTOOLS,
    slowMo: SLOWMO,
    ignoreHTTPSErrors: true,
    dumpio: false,
    args: [...args, ...(DEVTOOLS ? ['--auto-open-devtools-for-tabs'] : [])],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    stepInfo('Abrindo página inicial', `URL=${seletores.urlInicial}`);
    await page.goto(seletores.urlInicial, { waitUntil: 'load', timeout: 60000 });
    stepInfo('Página inicial carregada', `ms=${Date.now() - t0}`);

    const clickIfExists = async (selector) => {
      const el = await page.$(selector);
      if (el) await el.click();
      else logger.warn(`[${idCaixaSimulator}] Elemento não encontrado: ${selector}`);
    };

    /* ========= Etapa 1 ========= */
    stepInfo('Etapa 1: tipo de imóvel e finalidade', `tipoPessoa=${dados.tipoPessoa} tipoFinanciamento=${dados.tipoFinanciamento} finalidade="${dados.finalidade}" uf=${dados.uf} cidade="${dados.cidade}"`);
    const selPessoa = seletores.camposEtapa1.tipoPessoa(dados.tipoPessoa);
    await page.waitForSelector(selPessoa, { visible: true, timeout: 15000 });
    await page.click(selPessoa);
    await sleep(300);

    await page.waitForFunction(() => {
      const s = document.getElementById('tipoImovel');
      return s && s.options && s.options.length >= 3;
    }, { timeout: 20000 });

    const tipoValor = tipoImovelMap[dados.tipoFinanciamento] ?? dados.tipoFinanciamento;
    if (!await setComboboxValue('tipoImovel', tipoValor))
      throw new Error(`Não consegui selecionar "tipoImovel" com "${dados.tipoFinanciamento}"`);

    await page.waitForFunction(() => {
      const s = document.getElementById('categoriaImovel');
      return s && s.options && s.options.length > 1;
    }, { timeout: 20000 });

    const finValor = finalidadeMap[dados.finalidade] ?? dados.finalidade;
    if (!await setComboboxValue('categoriaImovel', finValor))
      throw new Error(`Não consegui selecionar "categoriaImovel" com "${dados.finalidade}"`);

    if (dados.valorReforma === '3') {
      await clearByDomAndType(seletores.camposEtapa1.valorReforma, dados.valorReforma);
    }

    await setMoney(seletores.camposEtapa1.valorImovel, dados.valorImovel);

    await page.select(seletores.camposEtapa1.uf, dados.uf);
    await page.waitForFunction(
      (sel) => { const s = document.querySelector(sel); return !!s && s.options && s.options.length > 1; },
      { timeout: 20000 },
      seletores.camposEtapa1.cidade
    );

    const cidadeValue = await page.evaluate(
      (selC, nomeCidade) => {
        const norm = s => String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim().toLowerCase();
        const s = document.querySelector(selC);
        if (!s) return null;
        const alvo = norm(nomeCidade);
        const opts = Array.from(s.options);
        let match = opts.find(o => norm(o.text) === alvo);
        if (match) return match.value;
        match = opts.find(o => norm(o.value) === alvo);
        return match ? match.value : null;
      },
      seletores.camposEtapa1.cidade,
      dados.cidade
    );
    if (!cidadeValue) throw new Error(`Cidade não encontrada (normalizada): ${dados.cidade}`);
    await page.select(seletores.camposEtapa1.cidade, cidadeValue);

    if (String(dados.imovelCidade).toLowerCase().startsWith('s')) await clickIfExists(seletores.camposEtapa1.imovelCidade);
    if (String(dados.portabilidade).toLowerCase().startsWith('s')) await clickIfExists(seletores.camposEtapa1.portabilidade);

    const btn1 = seletores.camposEtapa1.btnNext1;
    await page.waitForSelector(btn1, { visible: true, timeout: 10000 });
    await page.waitForFunction(sel => {
      const el = document.querySelector(sel);
      return el && !el.disabled && el.offsetParent !== null;
    }, { timeout: 10000 }, btn1);
    await page.evaluate(sel => document.querySelector(sel).click(), btn1);
    await sleep(600);
    stepInfo('Etapa 1 concluída');

    /* ========= Etapa 2 =========
     * CPF/Telefone/Renda/Data — SEM duplicar
     */
    stepInfo('Etapa 2: dados pessoais');
    // Desliga qualquer autocomplete e limpa antes
    await page.evaluate(() => {
      for (const sel of ['#nuCpfCnpjInteressado','#nuTelefoneCelular','#rendaFamiliarBruta','#dataNascimento']) {
        const el = document.querySelector(sel);
        if (el) { el.setAttribute('autocomplete','off'); el.autocomplete='off'; el.value=''; }
      }
    });

    if (dados.cpf) {
      await clearByDomAndType(seletores.camposEtapa2.cpf, onlyDigits(dados.cpf));
    }

    // Telefone: enviar SOMENTE 11 dígitos (DDD+numero). O site, se quiser, coloca (55) sozinho.
    if (dados.telefone) {
      const digits11 = lastNDigits(dados.telefone, 11);
      // Formata: (51)99999-9991
      const formatted = `(${digits11.slice(0, 2)})${digits11.slice(2, 7)}-${digits11.slice(7)}`;
      
      await page.waitForSelector(seletores.camposEtapa2.telefone, { visible: true, timeout: 15000 });
      
      await page.$eval(seletores.camposEtapa2.telefone, (el) => {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });

      await page.$eval(seletores.camposEtapa2.telefone, (el, val) => {
        el.value = val;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur?.();
      }, formatted);

      await sleep(120);
    }
    /*if (dados.telefone) {
      const digits11 = lastNDigits(dados.telefone, 11);
      await clearByDomAndType(seletores.camposEtapa2.telefone, digits11);
    }*/

    await clearByDomAndType(seletores.camposEtapa2.renda, centsToDigits(dados.renda));
    await clearByDomAndType(seletores.camposEtapa2.dataNascimento, dateToDigits(dados.dataNascimento));

    if (String(dados.temFGTS).toLowerCase().startsWith('s'))                await clickIfExists(seletores.camposEtapa2.temFGTS);
    if (String(dados.foiBeneficiadoFGTS).toLowerCase().startsWith('s'))     await clickIfExists(seletores.camposEtapa2.foiBeneficiadoFGTS);
    if (String(dados.temDependente).toLowerCase().startsWith('s'))          await clickIfExists(seletores.camposEtapa2.temDependente);
    if (String(dados.temRelacionamentoCaixa).toLowerCase().startsWith('s')) await clickIfExists(seletores.camposEtapa2.temRelacionamentoCaixa);

    const btn2 = seletores.camposEtapa2.btnNext2;
    await page.waitForSelector(btn2, { visible: true, timeout: 12000 });
    await page.$eval(btn2, el => el.scrollIntoView({ block: 'center' }));
    await page.$eval(btn2, el => el.click());
    await sleep(1200);
    stepDebug('Etapa 2 preenchida', `cpf=${maskCpfCnpj(dados.cpf)} tel=${maskPhone(dados.telefone)} renda=${dados.renda} nascimento=${dados.dataNascimento}`);
    stepInfo('Etapa 2 concluída');

    /* ========= Etapa 3 ========= */
    stepInfo('Etapa 3: escolha da linha de crédito', `linhaCredito="${dados.linhaCredito}"`);
    const alvo = normalizeString(String(dados.linhaCredito || '')).toLowerCase();
    await page.waitForFunction(() => document.querySelectorAll('a.js-form-next').length > 0, { timeout: 30000 });
    const escolhida = await page.evaluate(label => {
      const normalize = str => str.normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/\s+/g,' ').trim().toLowerCase();
      const links = Array.from(document.querySelectorAll('a.js-form-next'));
      let m = links.find(a => normalize(a.textContent) === label);
      if (!m) m = links.find(a => normalize(a.textContent).includes(label));
      if (m) { m.click(); return true; }
      return false;
    }, alvo);
    if (!escolhida) throw new Error(`Linha de crédito não encontrada: ${dados.linhaCredito}`);
    await sleep(2500);
    stepInfo('Linha de crédito selecionada');

    /* ========= Screenshot ========= */
    stepInfo('Capturando screenshot parcial');
    // Captura apenas 40% do topo da página com melhor qualidade
    const viewport = await page.viewport();
    const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const clipHeight = Math.floor(fullHeight * 0.38);
    
    const buffer = await page.screenshot({ 
      type: 'jpeg', 
      quality: 85,
      clip: {
        x: 0,
        y: 0,
        width: viewport.width,
        height: clipHeight
      }
    });
    const localPath = path.join(screenshotsDir, `${idCaixaSimulator}.jpg`);
    fs.writeFileSync(localPath, buffer);

    const driveFileId = await uploadFileToS3(
      localPath,
      `${__env}/simulator-caixa/screenshots/${idCaixaSimulator}.jpg`,
      'image/jpeg'
    );
    try { fs.unlinkSync(localPath); } catch {}
    stepInfo('Screenshot enviada ao S3', `driveFileId=${driveFileId}`);

    /* ========= Etapa 4: extração ========= */
    stepInfo('Extraindo resultados');
    const dadosResultado = await page.evaluate(
      ({ seletorTitulo, seletorResumo, seletorComparativa, seletorOnclickSeguradora, seletorTabelaCob }) => {
        const tituloEl = document.querySelector(seletorTitulo);
        const titulo = tituloEl ? tituloEl.innerText.trim() : '';

        const resumoEl = document.querySelector(seletorResumo);
        const resumo = {};
        if (resumoEl) {
          resumoEl.querySelectorAll('tbody tr').forEach(tr => {
            const tds = tr.querySelectorAll('td');
            if (tds.length >= 2) {
              const chave = tds[0].innerText.trim();
              const valor = tds[1].innerText.trim();
              resumo[chave] = valor;
            }
          });
        }

        const containerComparativa = document.querySelector(seletorComparativa);
        let opcoesComparativas = [];
        if (containerComparativa) {
          const headerTds = Array.from(containerComparativa.querySelectorAll(seletorOnclickSeguradora));
          const opcoesFin = headerTds.map(td => {
            const onclick = td.getAttribute('onclick') || '';
            const m = onclick.match(/detalhaPrestacaoSeguradora\(\s*'0'\s*,\s*(\d+)\s*,\s*'([^']+)'/);
            return { codigoSeguradora: (m?.[1] || '').trim(), seguradora: (m?.[2] || '').trim() };
          });

          opcoesFin.forEach((opt, idx) => {
            const cod = opt.codigoSeguradora;
            const jNom  = containerComparativa.querySelector(`input[name="jurosNominaisCondicao${cod}-0"]`);
            const jEfet = containerComparativa.querySelector(`input[name="jurosEfetivosCondicao${cod}-0"]`);
            const prest = containerComparativa.querySelector(`input[name="prestacaoCondicao${cod}-0"]`);
            opt['Juros Nominais'] = jNom?.value?.trim() || '';
            opt['Juros Efetivos'] = jEfet?.value?.trim() || '';
            opt['1ª Prestação']   = prest?.value?.trim() || '';

            const linhas = Array.from(containerComparativa.querySelectorAll('tr'));
            linhas.forEach(tr => {
              const cols = tr.querySelectorAll('td');
              if (cols[0]?.innerText.trim() === 'Última Prestação') {
                opt['Última Prestação'] = cols[idx + 1]?.innerText.trim() || '';
              }
            });
          });

          const tabelaCobertura = document.querySelector(seletorTabelaCob);
          if (tabelaCobertura) {
            const rows = Array.from(tabelaCobertura.querySelectorAll('tbody tr')).slice(1);
            rows.forEach(tr => {
              const tds = Array.from(tr.querySelectorAll('td'));
              const chaveCob = tds[0]?.innerText.trim() || '';
              tds.slice(1).forEach((td, i) => {
                const img = td.querySelector('img');
                let v = '';
                if (img) {
                  const src = img.getAttribute('src') || '';
                  v = src.includes('ok.gif') ? 'Sim' : (src.includes('menos_redondo_calc.png') ? 'Não' : '');
                }
                if (opcoesFin[i]) opcoesFin[i][chaveCob] = v;
              });
            });
          }
          opcoesComparativas = opcoesFin;
        }

        return { titulo, ...resumo, opcoesComparativas };
      },
      {
        seletorTitulo: seletores.resultadoEtapa4.titulo,
        seletorResumo: seletores.resultadoEtapa4.containerResumo,
        seletorComparativa: seletores.resultadoEtapa4.containerComparativa,
        seletorOnclickSeguradora: seletores.resultadoEtapa4.tdOnclickSeguradora,
        seletorTabelaCob: seletores.resultadoEtapa4.tabelaCobertura,
      }
    );
    stepInfo('Extração concluída', `titulo="${dadosResultado.titulo || ''}" opcoesComparativas=${Array.isArray(dadosResultado.opcoesComparativas) ? dadosResultado.opcoesComparativas.length : 0}`);

    // chave amigável
    const oldKey = "Sistema de amortização    / \nindexador: SAC /\nTR - Sistema de Amortização Constante";
    const newKey = "Sistema de amortização/indexador";
    if (Object.prototype.hasOwnProperty.call(dadosResultado, oldKey)) {
      const desc = Object.getOwnPropertyDescriptor(dadosResultado, oldKey);
      Object.defineProperty(dadosResultado, newKey, desc);
      delete dadosResultado[oldKey];
    }

    // opcionalmente remove colunas de cobertura (Sim/Não)
    if (!INCLUDE_COBERTURA && Array.isArray(dadosResultado.opcoesComparativas)) {
      dadosResultado.opcoesComparativas.forEach(op => {
        for (const k of Object.keys(op)) {
          if (op[k] === 'Sim' || op[k] === 'Não') delete op[k];
        }
      });
    }

    if (!KEEP_OPEN_ON_SUCCESS) await browser.close();
    else { logger.warn(`[${idCaixaSimulator}] Sucesso – mantendo navegador aberto para inspeção.`); await sleep(15 * 60_000); }

    stepInfo('Persistindo simulação no banco');
    await Simulacao.create({
      _id: idCaixaSimulator,
      dadosInput: dados,
      dadosOutput: { ...dadosResultado },
      driveFileId,
      status: 'success'
    });
    stepInfo('Persistência concluída');

    // callbacks de sucesso
    const targetsOk = await resolveCallbackTargets(dados);
    if (targetsOk?.length) {
      logger.info(`[callback] destinos (from env): ${targetsOk.join(', ')}`);
    } else {
      logger.warn('[callback] nenhum destino resolvido a partir de APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL');
    }
    stepInfo('Disparando callbacks de sucesso', `qtd=${targetsOk.length}`);
    await Promise.all(targetsOk.map(u => notifyCallback(u, {
      simulationId: idCaixaSimulator.toString(),
      whatsappSimulationId: dados.whatsappSimulationId || null,
      status: 'success',
      driveFileId,
      dadosOutput: { ...dadosResultado },
      dadosInput: dados,
      finishedAt: new Date().toISOString(),
    })));

    logger.info(`[${idCaixaSimulator}] Simulação finalizada com sucesso!`);
    return {
      _id: idCaixaSimulator.toString(),
      whatsappSimulationId: dados.whatsappSimulationId || null,
      dadosInput: dados,
      dadosOutput: { ...dadosResultado },
      driveFileId,
      status: 'success'
    };
  } catch (error) {
    // Screenshot de erro antes de qualquer encerramento
    let errorDriveFileId = null;
    try {
      if (page) {
        const bufferErr = await page.screenshot({ type: 'jpeg', quality: 85, fullPage: true });
        const localErr = path.join(screenshotsDir, `${idCaixaSimulator}-error.jpg`);
        fs.writeFileSync(localErr, bufferErr);
        errorDriveFileId = await uploadFileToS3(
          localErr,
          `${__env}/simulator-caixa/screenshots/${idCaixaSimulator}-error.jpg`,
          'image/jpeg'
        );
        try { fs.unlinkSync(localErr); } catch {}
        logger.info(`[${idCaixaSimulator}] Screenshot de erro enviada ao S3 | driveFileIdError=${errorDriveFileId}`);
      }
    } catch (eShot) {
      logger.warn(`[${idCaixaSimulator}] Falha ao capturar/enviar screenshot de erro: ${eShot?.message || eShot}`);
    }

    stepInfo('Falha na simulação', error?.message || String(error));
    try {
      await Simulacao.create({
        _id: idCaixaSimulator,
        dadosInput: dados,
        status: 'error',
        errorMessage: error.message,
        errorDriveFileId
      });
    } catch {}
    stepInfo('Persistência de erro concluída');

    // callbacks de erro
    const targetsErr = await resolveCallbackTargets(dados);
    if (targetsErr?.length) {
      logger.info(`[callback] destinos (from env): ${targetsErr.join(', ')}`);
    } else {
      logger.warn('[callback] nenhum destino resolvido a partir de APP_WHATSAPP_SERVICE_CAIXA_SIMULATOR_WEBHOOK_URL');
    }
    stepInfo('Disparando callbacks de erro', `qtd=${targetsErr.length}`);
    await Promise.all(targetsErr.map(u => notifyCallback(u, {
      simulationId: idCaixaSimulator.toString(),
      whatsappSimulationId: dados.whatsappSimulationId || null,
      status: 'error',
      error: error.message,
      errorDriveFileId,
      dadosInput: dados,
      finishedAt: new Date().toISOString(),
    })));

    if (!KEEP_OPEN_ON_ERROR) await browser.close();
    else { logger.warn(`[${idCaixaSimulator}] ERRO – mantendo navegador aberto para inspeção: ${error.message}`); await sleep(15 * 60_000); }
    error.simulationId = idCaixaSimulator.toString();
    throw new Error('Erro ao realizar simulação: ' + error.message);
  }
}

export default { caixaSimulator };
