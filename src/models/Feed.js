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

const newsletterConfigSchema = new mongoose.Schema(
  {
    senderPattern: { type: String, default: "" },
    subjectPattern: { type: String, default: "" },
    forwardedByPattern: { type: String, default: "" },
    mailbox: { type: String, default: "INBOX" },
    guidance: { type: String, default: "" },
    notes: { type: String, default: "" },
    previewItems: { type: [aiPreviewItemSchema], default: [] },
    latestMessageId: { type: String, default: "" },
    latestMessageSubject: { type: String, default: "" },
    latestMessageAt: { type: Date, default: null },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending"
    },
    lastVerifiedAt: { type: Date, default: null }
  },
  { _id: false }
);

const blueskyConfigSchema = new mongoose.Schema(
  {
    handle: { type: String, default: "" },
    includeReplies: { type: Boolean, default: false },
    includeReposts: { type: Boolean, default: false },
    notes: { type: String, default: "" },
    previewItems: { type: [aiPreviewItemSchema], default: [] },
    latestPostUri: { type: String, default: "" },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "failed"],
      default: "pending"
    },
    lastVerifiedAt: { type: Date, default: null }
  },
  { _id: false }
);

const feedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    siteUrl: { type: String, default: "" },
    feedUrl: { type: String, required: true },
    sourceType: { type: String, enum: ["rss", "ai_scraped", "newsletter", "bluesky"], default: "rss" },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory", default: null },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory" }],
    iconUrl: { type: String, default: "" },
    language: { type: String, default: "" },
    updateIntervalMinutes: { type: Number, default: 15 },
    fetchFullContent: { type: Boolean, default: false },
    autoArchiveDays: { type: Number, default: 0 },
    generatedFeedKey: { type: String, required: true },
    aiConfig: { type: aiConfigSchema, default: null },
    newsletterConfig: { type: newsletterConfigSchema, default: null },
    blueskyConfig: { type: blueskyConfigSchema, default: null },
    lastUpdatedAt: { type: Date, default: null },
    lastError: { type: String, default: "" },
    nextRefreshAt: { type: Date, default: null }
  },
  { timestamps: true }
);

feedSchema.index({ userId: 1, feedUrl: 1 }, { unique: true });

module.exports = mongoose.model("Feed", feedSchema);
