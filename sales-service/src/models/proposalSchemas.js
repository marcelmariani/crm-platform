/* === D:\SmartIASystems\sales-service\src\models\proposalSchemas.js === */
// src/validation/proposalSchemas.js
import { z } from 'zod';

const statusKey = z.string().min(1).max(80).regex(/^[a-z0-9_]+$/).transform(s => s.toLowerCase());
const isoDate = z.string().datetime().transform(s => new Date(s));
const objectId = () => z.string().min(1);

const product = z.object({
  productId: objectId(),
  amount: z.number().positive().optional(),
  downPayment: z.number().nonnegative().optional(),
  financingType: z.string().min(1),
  purpose: z.string().min(1),
  unitPrice: z.number().positive(),
  clientHasProperty: z.boolean(),
  requestPortability: z.boolean(),
  authorizeLGPD: z.boolean(),
  requestBankRelationship: z.boolean(),
  useFGTS: z.boolean(),
  clientBenefitedFGTS: z.boolean(),
  coBuyer: z.boolean().optional(),
});

export const createProposalSchema = z.object({
  body: z.object({
    buyerId:  z.array(objectId()).min(1),
    sellerId: z.array(objectId()).optional(),
    products: z.array(product).min(1),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const updateProposalSchema = z.object({
  body: z.object({
    status: statusKey.optional(),
    statusChangeNote: z.string().max(2000).optional(),
    statusDeadlineAt: isoDate.optional(),
    products: z.array(product).min(1).optional(),
  })
  .refine(v => v.status || v.products, { message: 'Informe status ou products' }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const idParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const statusEndpointSchema = z.object({
  body: z.object({
    note: z.string().max(2000).optional(),
    statusDeadlineAt: isoDate.optional(),
  }),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({}).optional(),
});

// Consulta por número da proposta (padded ou número direto)
export const proposalNumberParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ number: z.string().min(1) }),
  query: z.object({}).optional(),
});

// Consulta por CPF do comprador
export const buyerCpfQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({ cpf: z.string().min(11).max(14) }),
});
