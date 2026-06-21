const mongoose = require("mongoose");

const filterRuleSchema = new mongoose.Schema(
  {
    field: { type: String, enum: ["title", "content", "author", "link", "tags"], required: true },
    pattern: { type: String, required: true },
    inverse: { type: Boolean, default: false }
  },
  { _id: false }
);

const filterActionSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["delete", "markRead", "star", "publish", "tag", "score", "label", "stop", "ignoreTags"],
      required: true
    },
    value: { type: String, default: "" }
  },
  { _id: false }
);

const filterSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    caption: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    matchMode: { type: String, enum: ["all", "any"], default: "all" },
    inverse: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    rules: [filterRuleSchema],
    actions: [filterActionSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model("Filter", filterSchema);
