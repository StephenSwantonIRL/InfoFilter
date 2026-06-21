const mongoose = require("mongoose");

const articleSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    feedId: { type: mongoose.Schema.Types.ObjectId, ref: "Feed", required: true, index: true },
    guid: { type: String, required: true },
    title: { type: String, required: true },
    link: { type: String, default: "" },
    author: { type: String, default: "" },
    content: { type: String, default: "" },
    summary: { type: String, default: "" },
    tags: [{ type: String }],
    labelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Label" }],
    score: { type: Number, default: 0 },
    publishedAt: { type: Date, default: Date.now },
    importedAt: { type: Date, default: Date.now },
    updatedAtFeed: { type: Date, default: Date.now },
    isRead: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    isPublished: { type: Boolean, default: false },
    isArchived: { type: Boolean, default: false },
    note: { type: String, default: "" }
  },
  { timestamps: true }
);

articleSchema.index({ userId: 1, guid: 1, feedId: 1 }, { unique: true });

module.exports = mongoose.model("Article", articleSchema);
