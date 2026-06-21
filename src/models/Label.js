const mongoose = require("mongoose");

const labelSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    color: { type: String, default: "#3273dc" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Label", labelSchema);
