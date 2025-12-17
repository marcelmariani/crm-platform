// src/models/adminConfiguration.model.js
import mongoose from 'mongoose';

const { Schema } = mongoose;

const STATUS = ['active', 'inactive'];
const normalizeStatus = (v) => {
  const m = { ativo: 'active', inativo: 'inactive', active: 'active', inactive: 'inactive' };
  const s = String(v ?? 'active').toLowerCase();
  return m[s] || 'active';
};

/** Pergunta dinâmica */
const QuestionSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      description: 'Chave do parâmetro no simulador',
    },
    type: {
      type: String,
      enum: ['enum', 'string', 'float', 'boolean', 'date', 'documentNumber', 'int', 'callback'],
      required: true,
      description: 'Tipo de dado esperado',
    },
    options: {
      type: [String],
      default: [],
      description: 'Opções válidas para campos enum',
      validate: {
        validator(value) {
          // Quando type === 'enum', precisa ter pelo menos 1 opção
          if (this.type === 'enum') return Array.isArray(value) && value.length > 0;
          return true;
        },
        message: 'Para perguntas do tipo "enum", defina pelo menos uma opção.',
      },
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
      description: 'Texto a ser exibido para usuário',
    },
    simulatorParam: {
      type: String,
      required: true,
      trim: true,
      description: 'Nome do parâmetro que vai ao simulador',
    },
    validation: {
      type: Schema.Types.Mixed,
      default: {},
      description: 'Objeto com regras de validação (ex: { min:1, max:100 })',
    },
    required: {
      type: Boolean,
      default: true,
      description: 'Define se a pergunta é obrigatória',
    },
    autocomplete: {
      type: Boolean,
      default: false,
      description: 'Define se o atributo é preenchido automaticamente pelo sistema',
    },
    valueAutocomplete: {
      type: String,
      trim: true,
      description: 'Valor do preenchimento automático',
    },
  },
  { _id: false }
);

const InsuranceCompanySchema = new Schema(
  {
    idInsuranceCompany: { type: String, required: true, trim: true },
    insuranceCompanyName: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const AdminConfigurationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    idBank: { type: Schema.Types.ObjectId, ref: 'Bank', required: true, index: true },
    prompt: { type: String, required: true, trim: true },
    creditRules: { type: String, required: true, trim: true },
    insuranceCompany: { type: [InsuranceCompanySchema], default: [] },
    questions: {
      type: [QuestionSchema],
      required: true,
      description: 'Lista de perguntas com metadados para o simulador',
    },
    services: {
      type: [String],
      enum: [
        '1.Simular Financiamento Imobiliário',
        '2.Consultar Simulação Financiamento Imobiliário',
        '3.Solicitar Empréstimo Consignado',
        '4.Efetuar Consórcio',
        '5.Abrir Conta',
        '6.Solicitar Cartão de Crédito',
        '7.Solicitar Cheque Especial',
        '8.Solicitar Seguros',
        '9.Dúvidas Gerais sobre nossos Serviços',
      ],
      default: [],
    },
    status: {
      type: String,
      enum: STATUS,
      default: 'active',
      set: normalizeStatus, // aceita 'ativo'/'inativo'
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// nome + banco únicos
AdminConfigurationSchema.index({ name: 1, idBank: 1 }, { unique: true });

export default mongoose.models.AdminConfiguration ||
  mongoose.model('AdminConfiguration', AdminConfigurationSchema);
