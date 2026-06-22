const mongoose = require("mongoose");

const aiPreviewItemSchema = new mongoose.Schema(
  {
    title: { type: String, default: "" },
    link: { type: String, default: "" },
    publishedAt: { type: String, default: "" },
    summary: { type: String, default: "" }
  },
  { _id: false }
);

const aiRuleSchema = new mongoose.Schema(
  {
    itemSelector: { type: String, default: "" },
    titleSelector: { type: String, default: "" },
    linkSelector: { type: String, default: "" },
    dateSelector: { type: String, default: "" },
    summarySelector: { type: String, default: "" },
    contentSelector: { type: String, default: "" },
    titleAttribute: { type: String, default: "" },
    linkAttribute: { type: String, default: "href" },
    dateAttribute: { type: String, default: "" },
    maxItems: { type: Number, default: 20 }
  },
  { _id: false }
);

const aiConfigSchema = new mongoose.Schema(
  {
    guidance: { type: String, default: "" },
    notes: { type: String, default: "" },
    fetchMode: { type: String, enum: ["auto", "direct", "browser"], default: "auto" },
    waitUntil: { type: String, enum: ["domcontentloaded", "load", "networkidle"], default: "networkidle" },
    waitForSelector: { type: String, default: "" },
    waitAfterLoadMs: { type: Number, default: 1500 },
    lastResolvedFetchMode: { type: String, default: "" },
    rule: { type: aiRuleSchema, default: () => ({}) },
    previewItems: { type: [aiPreviewItemSchema], default: [] },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "repairing", "failed"],
      default: "pending"
    },
    lastVerifiedAt: { type: Date, default: null },
    lastRepairAt: { type: Date, default: null },
    lastRepairReason: { type: String, default: "" },
    repairCount: { type: Number, default: 0 }
  },
  { _id: false }
);

const feedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    siteUrl: { type: String, default: "" },
    feedUrl: { type: String, required: true },
    sourceType: { type: String, enum: ["rss", "ai_scraped"], default: "rss" },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory", default: null },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory" }],
    iconUrl: { type: String, default: "" },
    language: { type: String, default: "" },
    updateIntervalMinutes: { type: Number, default: 15 },
    fetchFullContent: { type: Boolean, default: false },
    autoArchiveDays: { type: Number, default: 0 },
    generatedFeedKey: { type: String, required: true },
    aiConfig: { type: aiConfigSchema, default: null },
    lastUpdatedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    nextRefreshAt: { type: Date, default: null }
  },
  { timestamps: true }
);

feedSchema.index({ userId: 1, feedUrl: 1 }, { unique: true });

module.exports = mongoose.model("Feed", feedSchema);
