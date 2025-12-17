import removeAccents from "remove-accents";

const toStr = (v) => (v === null || v === undefined) ? "" : (typeof v === "string" ? v : String(v));

/**
 * Normaliza e valida uma resposta conforme o tipo da pergunta.
 * Aceita entradas string, number e boolean com tolerância.
 * Para "float" retorna valor em centavos (inteiro).
 */
export function normalizeAnswer(step = {}, rawText) {
  const raw  = toStr(rawText).trim();
  const norm = removeAccents(raw).toLowerCase();

  switch (step.type) {
    case "date": {
      let formatted = raw;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split("-");
        formatted = `${d}/${m}/${y}`;
      }
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(formatted))
        throw new Error("Data inválida, use DD/MM/AAAA");
      
      // Validação adicional: verificar se a data é válida
      const [day, month, year] = formatted.split('/').map(Number);
      const date = new Date(year, month - 1, day);
      
      if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
      ) {
        throw new Error("Data inválida. Por favor, informe uma data válida no formato DD/MM/AAAA");
      }
      
      // Validação adicional: verificar se a data não é futura
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date > today) {
        throw new Error("Data não pode ser futura. Por favor, informe uma data válida");
      }
      
      // Validação adicional: verificar se a data não é muito antiga (ex: antes de 1900)
      if (year < 1900) {
        throw new Error("Data inválida. Por favor, informe uma data válida");
      }
      
      return formatted;
    }

    case "int": {
      let v;
      if (typeof rawText === "number") v = Math.trunc(rawText);
      else {
        const s = raw.replace(/[^\d-]/g, "");
        v = parseInt(s, 10);
      }
      if (!Number.isFinite(v)) throw new Error("Valor inválido");
      if (step.validation?.min != null && v < step.validation.min) throw new Error("Valor abaixo do mínimo");
      if (step.validation?.max != null && v > step.validation.max) throw new Error("Valor acima do máximo");
      return v;
    }

    case "float": {
      let cents;
      if (typeof rawText === "number") {
        cents = Math.round(rawText * 100);
      } else {
        const rawClean = raw.replace(/\s+/g, "").replace(/\./g, "").replace(/R\$\s*/i, "");
        const [intPart = "", decPart = ""] = rawClean.split(",");
        const decNorm = (decPart + "00").slice(0, 2);
        const digits = intPart.replace(/[^\d]/g, "") + decNorm;
        cents = parseInt(digits, 10);
      }
      if (!Number.isFinite(cents)) throw new Error("Valor inválido");
      if (step.validation?.min != null && cents < step.validation.min) throw new Error("Valor abaixo do mínimo");
      if (step.validation?.max != null && cents > step.validation.max) throw new Error("Valor acima do máximo");
      return cents;
    }

    case "boolean": {
      if (typeof rawText === "boolean") return rawText ? "Sim" : "Não";
      const truthy = ["s", "sim", "y", "yes", "true", "1"];
      const falsy  = ["n", "nao", "não", "no", "false", "0"];
      if (truthy.includes(norm)) return "Sim";
      if (falsy.includes(norm))  return "Não";
      throw new Error("Resposta deve ser 'Sim'/'Não'");
    }

    case "enum": {
      const opts = Array.isArray(step.options) ? step.options : [];
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 1 && n <= opts.length) return opts[n - 1];
      const map = opts.reduce((m, o) => {
        m[removeAccents(String(o)).toLowerCase()] = o;
        return m;
      }, {});
      if (map[norm]) return map[norm];
      throw new Error(`Opção inválida: escolha entre ${opts.map((o,i) => `${i+1}. ${o}`).join("; ")}`);
    }

    case "string": {
      const min = step.validation?.min || 1;
      if (raw.length < min) throw new Error(`Texto muito curto, mínimo ${min} caracteres`);
      return raw;
    }

    case "documentNumber": {
      const onlyDigits = raw.replace(/\D/g, "");
      if (onlyDigits.length !== 11 || /^(\d)\1{10}$/.test(onlyDigits))
        throw new Error("CPF inválido");
      const calcDV = digits => {
        let sum = 0;
        for (let i = 0; i < digits.length; i++) {
          sum += parseInt(digits[i], 10) * (digits.length + 1 - i);
        }
        const res = (sum * 10) % 11;
        return res === 10 ? 0 : res;
      };
      const base = onlyDigits.slice(0, 9);
      if (
        calcDV(base) !== parseInt(onlyDigits[9], 10) ||
        calcDV(base + calcDV(base)) !== parseInt(onlyDigits[10], 10)
      ) throw new Error("CPF inválido");
      return onlyDigits;
    }

    default:
      return raw;
  }
}
