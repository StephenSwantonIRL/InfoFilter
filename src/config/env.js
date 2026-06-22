const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/infofilter",
  sessionSecret: process.env.SESSION_SECRET || "change-me",
  baseUrl: process.env.BASE_URL || "http://127.0.0.1:3000",
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  singleUserMode: process.env.SINGLE_USER_MODE === "true",
  appName: process.env.APP_NAME || "InfoFilter",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: process.env.OPENAI_MODEL || "gpt-5.5",
  openaiFallbackModels: parseCsv(process.env.OPENAI_FALLBACK_MODELS || "gpt-5.5"),
  minRefreshMinutes: Number(process.env.MIN_REFRESH_MINUTES || 10),
  maxRefreshMinutes: Number(process.env.MAX_REFRESH_MINUTES || 20),
  refreshSweepMs: Number(process.env.REFRESH_SWEEP_MS || 60000)
};
