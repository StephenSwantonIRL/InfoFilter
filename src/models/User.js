const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    displayName: { type: String, required: true },
    role: { type: String, enum: ["admin", "user", "readonly"], default: "user" },
    preferences: {
      theme: { type: String, default: "default" },
      digestEnabled: { type: Boolean, default: false },
      unreadOnly: { type: Boolean, default: true },
      sortOrder: { type: String, enum: ["newest", "oldest", "title"], default: "newest" },
      articleView: { type: String, enum: ["adaptive", "expanded"], default: "adaptive" }
    }
  },
  { timestamps: true }
);

userSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

userSchema.statics.hashPassword = function hashPassword(password) {
  return bcrypt.hash(password, 10);
};

module.exports = mongoose.model("User", userSchema);
