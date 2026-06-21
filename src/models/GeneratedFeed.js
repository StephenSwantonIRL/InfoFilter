const mongoose = require("mongoose");

const generatedFeedSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    scope: { type: String, enum: ["feed", "category", "label", "special", "search"], required: true },
    targetId: { type: String, required: true },
    title: { type: String, required: true },
    key: { type: String, required: true, unique: true },
    format: { type: String, enum: ["atom", "json"], default: "atom" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("GeneratedFeed", generatedFeedSchema);
