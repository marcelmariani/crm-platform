// src/normalize.js

/**
 * Normaliza uma string removendo acentuação, unificando espaços e aparando.
 * @param {string} str - Texto a ser normalizado.
 * @returns {string} Texto sem acentuação e espaços extras.
 */
export function normalizeString(str) {
  return str
    .normalize('NFD')                  // decompõe caracteres acentuados
    .replace(/\p{Diacritic}/gu, '')    // remove todos os diacríticos
    .replace(/\s+/g, ' ')              // unifica múltiplos espaços
    .trim();                           // remove espaços no início e fim
}