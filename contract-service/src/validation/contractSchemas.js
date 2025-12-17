// src/validation/contractSchemas.js
import { z } from 'zod';

// Helpers
const objectId = () =>
  z.string().regex(/^[a-f\d]{24}$/i, 'invalid ObjectId');

const contractNumber = () =>
  z.string().regex(/^\d{8}$/, 'invalid contract number');

const statusKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9_]+$/i)
  .transform((s) => s.toLowerCase());

const isoDate = z.string().datetime().transform((s) => new Date(s));

// Schemas
const product = z.object({
  productId: objectId(),
  financingType: z.string().min(1),
  purpose: z.string().min(1),
  unitPrice: z.coerce.number().positive(),
  clientHasProperty: z.coerce.boolean(),
  requestPortability: z.coerce.boolean(),
  authorizeLGPD: z.coerce.boolean(),
  requestBankRelationship: z.coerce.boolean(),
  useFGTS: z.coerce.boolean(),
  clientBenefitedFGTS: z.coerce.boolean(),
  coBuyer: z.coerce.boolean().optional(),
});

export const createContractSchema = z.object({
  body: z.object({
    proposalId: objectId(),
    proposalSequenceNumber: z.coerce.number().int().nonnegative(),
    buyerId: z.array(objectId()).min(1),
    sellerId: z.array(objectId()).min(1),
    products: z.array(product).min(1),
    status: statusKey.optional(),
    createdAtAgentId: z.string().optional(),
    createdAtRealEstateId: z.string().optional(),
    createdAtBankCorrespondentId: z.string().optional(),
    auditInformation: z.array(z.any()).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const updatecontractSchema = z.object({
  body: z
    .object({
      status: statusKey.optional(),
      statusChangeNote: z.string().max(2000).optional(),
      statusDeadlineAt: isoDate.optional(),
      products: z.array(product).min(1).optional(),
    })
    .refine((v) => v.status || v.products, { message: 'Informe status ou products' }),
  params: z.object({ id: objectId() }),
  query: z.object({}).optional(),
});

export const idParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: objectId() }),
  query: z.object({}).optional(),
});

export const statusEndpointSchema = z.object({
  body: z.object({
    note: z.string().max(2000).optional(),
    statusDeadlineAt: isoDate.optional(),
  }),
  params: z.object({ id: objectId() }),
  query: z.object({}).optional(),
});

export const contractNumberParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ number: contractNumber() }),
  query: z.object({}).optional(),
});

// Alias de compatibilidade
export const createcontractSchema = createContractSchema;
