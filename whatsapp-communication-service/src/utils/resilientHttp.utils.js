import axios from "axios";
import axiosRetry from "axios-retry";
import https from "https";
import logger from "../config/logger.js";

/**
 * Cliente HTTP resiliente para comunicação entre microserviços
 * 
 * Configuração otimizada para ambientes Lambda/containerizados:
 * - 4 tentativas (1 inicial + 3 retries) com delay de 3s entre cada
 * - Timeout de 30s por tentativa para dar tempo ao cold start (média de 20s)
 * - Retry em erros 429 (Too Many Requests), 5xx e erros de rede
 * - Logs detalhados de tentativas e latências
 */

// HTTPS Agent que ignora certificados auto-assinados (dev/staging)
const httpsAgent = new https.Agent({ 
  rejectUnauthorized: false,
  keepAlive: true,
  keepAliveMsecs: 30000
});

/**
 * Configuração de timeouts baseada no ambiente
 * Configurado para 4 tentativas (1 inicial + 3 retries) com delay de 3s entre cada
 * Timeout de 30s por tentativa para lidar com cold starts (média de 20s)
 */
const getTimeoutConfig = () => {
  return {
    timeout: 30000,   // 30s timeout por tentativa
    retries: 3,       // 3 retries (total 4 tentativas)
    retryDelay: 3000  // 3s de delay entre tentativas
  };
};

/**
 * Cria uma instância axios configurada com retry e resiliência
 */
export function createResilientHttpClient(customConfig = {}) {
  const config = getTimeoutConfig();
  
  const client = axios.create({
    httpsAgent,
    timeout: customConfig.timeout || config.timeout,
    ...customConfig
  });

  // Configura retry com delay fixo de 3s entre tentativas
  axiosRetry(client, {
    retries: typeof customConfig.retries === 'number' ? customConfig.retries : (customConfig.retryDisable ? 0 : config.retries),
    
    // Condições para retry
    retryCondition: (error) => {
      if (customConfig.retryDisable) return false;
      // Retry em erros de rede (ECONNREFUSED, ETIMEDOUT, etc)
      if (axiosRetry.isNetworkError(error)) {
        logger.warn('[ResilientHTTP] Network error, will retry', {
          message: error.message,
          code: error.code,
          url: error.config?.url
        });
        return true;
      }

      // Retry em erros 5xx (servidor indisponível/erro interno)
      if (axiosRetry.isRetryableError(error)) {
        logger.warn('[ResilientHTTP] Server error, will retry', {
          status: error.response?.status,
          url: error.config?.url
        });
        return true;
      }

      // Retry específico para 429 (Too Many Requests)
      if (error.response?.status === 429) {
        logger.warn('[ResilientHTTP] Rate limited (429), will retry', {
          url: error.config?.url
        });
        return true;
      }

      // Retry em 503 (Service Unavailable) - comum em cold starts
      if (error.response?.status === 503) {
        logger.warn('[ResilientHTTP] Service unavailable (503), will retry', {
          url: error.config?.url
        });
        return true;
      }

      return false;
    },

    // Delay fixo de 3s entre todas as tentativas
    retryDelay: (retryCount, error) => {
      const delay = config.retryDelay;
      
      logger.info('[ResilientHTTP] Retry attempt', {
        attempt: retryCount,
        maxRetries: config.retries,
        delayMs: delay,
        delaySeconds: delay / 1000,
        url: error.config?.url,
        reason: error.response?.status || error.code || error.message
      });

      return delay;
    },

    // Callback após cada retry
    onRetry: (retryCount, error, requestConfig) => {
      logger.debug('[ResilientHTTP] Retrying request', {
        attempt: retryCount,
        method: requestConfig.method?.toUpperCase(),
        url: requestConfig.url,
        errorStatus: error.response?.status,
        errorCode: error.code
      });
    }
  });

  // Interceptor para logar requisições bem-sucedidas
  client.interceptors.response.use(
    (response) => {
      const retryCount = response.config['axios-retry']?.retryCount || 0;
      if (retryCount > 0) {
        const totalWaitTime = retryCount * (config.retryDelay / 1000);
        logger.info('[ResilientHTTP] Request succeeded after retries', {
          url: response.config.url,
          status: response.status,
          retriesUsed: retryCount,
          totalTimeWaited: totalWaitTime + 's'
        });
      }
      return response;
    },
    (error) => {
      // Log final se todas as tentativas falharam
      const retryCount = error.config?.['axios-retry']?.retryCount || 0;
      const maxRetries = config.retries;
      
      if (retryCount >= maxRetries) {
        const totalWaitTime = maxRetries * (config.retryDelay / 1000);
        logger.error('[ResilientHTTP] All retry attempts exhausted', {
          url: error.config?.url,
          totalAttempts: retryCount + 1,
          totalWaitTimeSeconds: totalWaitTime,
          finalError: error.response?.status || error.code || error.message,
          errorData: error.response?.data ? 
            JSON.stringify(error.response.data).slice(0, 400) : undefined
        });
      }
      
      return Promise.reject(error);
    }
  );

  return client;
}

/**
 * Instância padrão do cliente HTTP resiliente
 * Use esta para a maioria das chamadas entre microserviços
 */
export const resilientHttp = createResilientHttpClient();

/**
 * Cliente com timeout e retries para operações críticas
 * Usa a mesma configuração padrão (timeout 30s, 3 retries, delay 3s)
 */
export const criticalHttp = createResilientHttpClient({
  timeout: 30000  // 30 segundos
});

/**
 * Cliente rápido com menos retries para operações não-críticas
 * Use para chamadas que devem falhar rápido se o serviço não responder
 */
export const fastHttp = createResilientHttpClient({
  timeout: 15000,  // 15 segundos
  retries: 2,      // Apenas 2 tentativas
  retryDelay: 500  // Delay de 500ms entre tentativas
});

export default resilientHttp;
