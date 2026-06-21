const mongoose = require("mongoose");

const feedCategorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: "FeedCategory", default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeedCategory", feedCategorySchema);
