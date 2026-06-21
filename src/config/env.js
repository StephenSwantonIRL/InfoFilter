const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

module.exports = {
  port: Number(process.env.PORT || 3000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/infofilter",
  sessionSecret: process.env.SESSION_SECRET || "change-me",
  baseUrl: process.env.BASE_URL || "http://127.0.0.1:3000",
  adminEmail: process.env.ADMIN_EMAIL || "admin@example.com",
  adminPassword: process.env.ADMIN_PASSWORD || "admin123",
  updateSchedule: process.env.UPDATE_SCHEDULE || "*/15 * * * *",
  singleUserMode: process.env.SINGLE_USER_MODE === "true",
  appName: process.env.APP_NAME || "InfoFilter"
};
