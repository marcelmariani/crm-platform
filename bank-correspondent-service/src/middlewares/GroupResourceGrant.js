// src/models/GroupResourceGrant.js
// Defines permission bitmasks for group-resource grants.

// Alinhado ao auth-service (CRUD bitmask)
export const PERM = {
  CREATE: 1,
  READ: 2,
  UPDATE: 4,
  DELETE: 8,
};
