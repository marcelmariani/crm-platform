/* === D:\SmartIASystems\whatsapp-communication-service\src\models\Conversation.js === */
import { Schema, model } from "mongoose";

const ConversationSchema = new Schema({
  whatsappPhoneNumber:     { type: String, required: true, index: true },
  whatsappPhoneNumberUser: { type: String, required: true, index: true },
  direction:               { type: String, enum: ["inbound","outbound"], required: true },
  message:                 { type: String, default: "" }
}, { versionKey: false, timestamps: true });

export default model("Conversation", ConversationSchema);
