// src/mappers/contactPresenter.js

/**
 * Serializa o contato no contrato público.
 * @param {object} docOrObj - Documento do Mongoose ou objeto simples
 * @param {object} [opts]
 * @param {{authId?: string, userName?: string}} [opts.actor] - quem executou a ação atual
 * @param {Date} [opts.actionAt] - quando ocorreu a ação atual
 */
export function presentContact(docOrObj, opts = {}) {
  const obj = typeof docOrObj?.toObject === 'function' ? docOrObj.toObject() : docOrObj || {};
  const createdAt = obj.createdAt ? new Date(obj.createdAt) : null;
  const updatedAt = obj.updatedAt ? new Date(obj.updatedAt) : null;

  // Histórico base: criação
  const baseHistory = [
    {
      from: null,
      to: 'created',
      note: 'criação',
      changedByAuthId: obj.createdByAuthId ?? null,
      changedByUserName: obj.createdByUserName ?? null,
      changedAt: createdAt,
    },
  ];

  let statusValue = 'created';
  let statusHistory = baseHistory;

  // Se já é client, status atual é "active" e adiciona transição criada -> ativa
  if (obj.type === 'client') {
    statusValue = 'active';
    statusHistory = [
      ...baseHistory,
      {
        from: 'created',
        to: 'active',
        note: 'qualificação para cliente',
        changedByAuthId: opts.actor?.authId ?? null,
        changedByUserName: opts.actor?.userName ?? null,
        changedAt: opts.actionAt ?? updatedAt ?? createdAt,
      },
    ];
  }

  const auditInformation = [
    {
      createdByAuthId: obj.createdByAuthId ?? null,
      createdByUserName: obj.createdByUserName ?? null,
      createdAt,
      updatedAt,
    },
  ];

  return {
    _id: obj._id,
    documentNumber: obj.documentNumber,
    phoneNumber: obj.phoneNumber,
    name: obj.name,
    email: obj.email,
    birthDate: obj.birthDate,
    monthlyIncome: obj.monthlyIncome,
    type: obj.type,
    status: [
      {
        status: statusValue,
        statusHistory,
      },
    ],
    auditInformation,
  };
}

export default presentContact;
