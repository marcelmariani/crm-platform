/* === D:\SmartIASystems\seller-service\src\mappers\sellerPresenter.js === */
// src/mappers/sellerPresenter.js

/**
 * Serializa o vendedor no contrato público.
 * Formato de status:
 *   "status": [{ "status": "<created|active|inactive>", "statusHistory": [...] }]
 */
export function presentseller(docOrObj) {
  const o = typeof docOrObj?.toObject === 'function' ? docOrObj.toObject() : (docOrObj || {});
  const createdAt = o.createdAt ? new Date(o.createdAt) : null;
  const updatedAt = o.updatedAt ? new Date(o.updatedAt) : null;

  const currentStatus = o.status || 'created';
  const statusHistory = Array.isArray(o.statusHistory) && o.statusHistory.length
    ? o.statusHistory
    : [
        {
          from: null,
          to: 'created',
          note: 'criação',
          changedByAuthId: o.createdByAuthId ?? null,
          changedByUserName: o.createdByUserName ?? null,
          changedAt: createdAt,
        },
      ];

  const auditInformation = [
    {
      createdByAuthId: o.createdByAuthId ?? null,
      createdByUserName: o.createdByUserName ?? null,
      createdAt,
      updatedAt,
    },
  ];

  return {
    _id: o._id,
    documentNumber: o.documentNumber,
    phoneNumber: o.phoneNumber,
    name: o.name,
    email: o.email,
    birthDate: o.birthDate,
    monthlyIncome: o.monthlyIncome,
    fiscalType: o.fiscalType,
    status: [
      {
        status: currentStatus,
        statusHistory,
      },
    ],
    auditInformation,
  };
}

export default presentseller;
