import { askChatGPT } from "../services/chatgpt.service.js";

function deriveFlags(collected = {}) {
  const val = (k) => collected?.[k];
  const str = (k) => String(val(k) ?? "").trim().toLowerCase();
  const asBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v > 0;
    const s = String(v ?? "").trim().toLowerCase();
    return ["sim", "s", "true", "1", "y"].includes(s);
  };

  const explicit =
    asBool(val("possuiImovel")) ||
    asBool(val("hasProperty")) ||
    asBool(val("temImovel")) ||
    asBool(val("possui_imovel"));

  const byCity = !!str("imovelCidade");

  const hasProperty = explicit || byCity;

  return {
    ...collected,
    possuiImovel: collected.possuiImovel ?? hasProperty,
    hasProperty: collected.hasProperty ?? hasProperty
  };
}

export const autocompleteHandlers = {
  /**
   * f_ChatGpt: decide valor com base em creditRules + collectedData.
   * Para enum, força correspondência exata às opções ou retorna sentinela de divergência.
   */
  async f_ChatGpt(step, { rules, collectedData }) {
    const isEnum = step?.type === "enum";
    const derived = deriveFlags(collectedData);

    const system = [
      isEnum
        ? "Escolha UMA opção exatamente igual a uma das listadas. Se faltar dado ou houver conflito, responda: 'Divergência: <motivo curto>'."
        : "Retorne apenas o valor solicitado. Sem explicações.",
      isEnum && Array.isArray(step.options) ? ["Opções válidas:", ...step.options].join("\n") : ""
    ].filter(Boolean).join("\n");

    const user = [
      "Regras de crédito:",
      typeof rules === "string" ? rules : JSON.stringify(rules ?? {}, null, 2),
      "Dados já coletados (com campos derivados):",
      JSON.stringify(derived ?? {}, null, 2)
    ].join("\n");

    const out = (await askChatGPT({ messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]})).trim();

    // Divergência → devolve sentinela para o fluxo tratar sem validar enum
    if (/^diverg[eê]ncia/i.test(out)) {
      return { __divergencia: out };
    }

    // Mapeamentos defensivos para atalhos comuns da IA
    if (isEnum && Array.isArray(step.options)) {
      if (/^sbpe\b/i.test(out))            return step.options[0];
      if (/vinculado/i.test(out))          return step.options[1];
      if (/recursos\s*fgts/i.test(out))    return step.options[2];
    }

    return out;
  }
};
