const mongoose = require("mongoose");

const feedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true },
    siteUrl: { type: String, default: "" },
    feedUrl: { type: String, required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory", default: null },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory" }],
    iconUrl: { type: String, default: "" },
    language: { type: String, default: "" },
    updateIntervalMinutes: { type: Number, default: 15 },
    fetchFullContent: { type: Boolean, default: false },
    autoArchiveDays: { type: Number, default: 0 },
    generatedFeedKey: { type: String, required: true },
    lastUpdatedAt: { type: Date, default: null },
    lastError: { type: String, default: "" }
  },
  { timestamps: true }
);

feedSchema.index({ userId: 1, feedUrl: 1 }, { unique: true });

module.exports = mongoose.model("Feed", feedSchema);
