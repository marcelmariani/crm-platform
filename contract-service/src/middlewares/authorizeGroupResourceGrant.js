// src/models/GroupResourceGrant.js
// Bitmask de permissões para recursos do grupo
export const PERM = Object.freeze({
  NONE:   0,
  CREATE: 1 << 0, // 1
  READ:   1 << 1, // 2
  UPDATE: 1 << 2, // 4
  DELETE: 1 << 3, // 8
});

// Escopos possíveis retornados pelo auth-service
export const SCOPE = Object.freeze({
  OWN:  'own',   // apenas registros do próprio usuário
  ORG:  'org',   // registros do grupo/organização
  ALL:  'all',   // tudo
});

// Tipo utilitário (documentação):
// {
//   groupId: string,
//   groupName: string,
//   resource: string,
//   perms: number,         // bitmask combinando PERM
//   scope: 'own'|'org'|'all',
//   isAdmin?: boolean
// }

export default PERM;
