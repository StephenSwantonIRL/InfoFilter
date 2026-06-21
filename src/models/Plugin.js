const mongoose = require("mongoose");

const pluginSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    scope: { type: String, enum: ["system", "user"], default: "user" },
    enabled: { type: Boolean, default: false },
    description: { type: String, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Plugin", pluginSchema);
