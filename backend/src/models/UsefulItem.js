// Kerakli buyumlar inventari: musordan chiqqan, lekin tashlanmaydigan dona buyumlar.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';

export const USEFUL_ITEM_STATUS = {
  AVAILABLE: 'available',
  SOLD: 'sold',
  GIVEN_AWAY: 'given_away',
  DISCARDED: 'discarded',
};

const voiceSchema = new mongoose.Schema(
  {
    telegramFileId: { type: String, default: null },
    mimeType: { type: String, default: null },
    duration: { type: Number, default: null },
    messageId: { type: Number, default: null },
  },
  { _id: false }
);

const usefulItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    estimatedPrice: { type: Number, default: null, min: 0 },
    acquiredAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, default: '' },

    sourceType: { type: String, enum: ['text', 'voice', 'miniapp'], default: 'text' },
    sourceText: { type: String, default: '' },
    voice: { type: voiceSchema, default: null },

    status: {
      type: String,
      enum: Object.values(USEFUL_ITEM_STATUS),
      default: USEFUL_ITEM_STATUS.AVAILABLE,
      index: true,
    },
    closedAt: { type: Date, default: null },
    closedReason: { type: String, default: null },
    recipient: { type: String, default: null },
    soldAmount: { type: Number, default: null, min: 0 },
    saleTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    ...softDeleteFields,
  },
  { timestamps: true }
);

usefulItemSchema.plugin(tenantScopePlugin);
usefulItemSchema.index({ telegramUserId: 1, status: 1, acquiredAt: -1 });
usefulItemSchema.index({ telegramUserId: 1, normalizedName: 1, status: 1 });

export default mongoose.model('UsefulItem', usefulItemSchema);
