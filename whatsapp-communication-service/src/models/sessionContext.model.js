// src/models/sessionContext.model.js
import { Schema, model } from "mongoose";

const SessionContextSchema = new Schema({
  whatsappPhoneNumber:     { type: String, index: true, required: true },
  whatsappPhoneNumberUser: { type: String, index: true, required: true },
  whatsappJid:             { type: String, index: true },

  status: { type: String, enum: ["PENDING", "VERIFIED"], default: "PENDING" },

  // campos informativos do vínculo
  agentId: String,
  agentWhatsapp: String,            // <— NOVO: telefone do agente detectado
  agentWhatsappJid: String,         // <— NOVO: JID completo do agente
  licenseNumber: String,            // (opcional; mantido p/ compatibilidade)

  realEstateIds: [String],
  bankCorrespondentIds: [String],
  bankId: String,
  idAdminConfiguration: String,

  lastLog: Object,
  verifiedAt: Date,
  welcomeSent: { type: Boolean, default: false }
  ,
  consultation: Object
  ,
  // Fluxo de Dúvidas Gerais (Opção 9)
  doubts: Object
}, { versionKey: false, timestamps: true });

export default model("SessionContext", SessionContextSchema);
