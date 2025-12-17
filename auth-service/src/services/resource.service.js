import Resource from '../models/resource.model.js';

/**
 * Cria um novo recurso.
 * Lança erro com { code: 11000 } se nome duplicado.
 */
export async function createResource({ resourceName, status = 'active' }) {
  // Checagem explícita para retornar erro amigável antes do índice unique
  const exists = await Resource.findOne({ resourceName }).lean();
  if (exists) {
    const err = new Error('resourceName already exists');
    err.code = 11000;
    err.keyValue = { resourceName };
    throw err;
  }
  return Resource.create({ resourceName, status });
}

/**
 * Lista todos os recursos, com filtro opcional de status.
 */
export async function listResources({ status }) {
  const filter = {};
  if (status) filter.status = status;
  return Resource.find(filter).lean();
}

/**
 * Obtém um recurso por ID.
 */
export async function getResourceById(id) {
  return Resource.findById(id).lean();
}

/**
 * Obtém um recurso por nome.
 */
export async function getResourceByName(resourceName) {
  return Resource.findOne({ resourceName }).lean();
}

/**
 * Atualiza um recurso por ID.
 * Se tentar renomear para um nome já existente, lança code 11000 (409).
 */
export async function updateResource(id, { resourceName, status }) {
  const update = {};
  if (resourceName !== undefined) {
    // Verifica duplicidade antes de tentar atualizar
    const dup = await Resource.findOne({ resourceName }).lean();
    if (dup && String(dup._id) !== String(id)) {
      const err = new Error('resourceName already exists');
      err.code = 11000;
      err.keyValue = { resourceName };
      throw err;
    }
    update.resourceName = resourceName;
  }
  if (status !== undefined) update.status = status;

  return Resource.findByIdAndUpdate(id, update, { new: true }).lean();
}

/**
 * Soft-delete: marca como 'inactive'.
 */
export async function deleteResource(id) {
  return Resource.findByIdAndUpdate(id, { status: 'inactive' }, { new: true }).lean();
}
