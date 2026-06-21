const cron = require("node-cron");
const User = require("../models/User");
const Label = require("../models/Label");
const Plugin = require("../models/Plugin");
const env = require("../config/env");
const { refreshAllFeedsForUser } = require("./feedService");

async function ensureAdminUser() {
  const existing = await User.findOne({ email: env.adminEmail.toLowerCase() });
  if (!existing) {
    const passwordHash = await User.hashPassword(env.adminPassword);
    await User.create({
      email: env.adminEmail.toLowerCase(),
      passwordHash,
      displayName: "Administrator",
      role: "admin"
    });
  }
}

async function ensureDefaults() {
  await ensureAdminUser();

  if (await Plugin.countDocuments() === 0) {
    await Plugin.insertMany([
      { name: "share-links", scope: "user", enabled: true, description: "Adds share actions for articles." },
      { name: "digest-mailer", scope: "system", enabled: false, description: "Stub system plugin for email digests." }
    ]);
  }

  const admin = await User.findOne({ email: env.adminEmail.toLowerCase() });
  if (admin && await Label.countDocuments({ userId: admin._id }) === 0) {
    await Label.insertMany([
      { userId: admin._id, name: "Important", color: "#ff3860" },
      { userId: admin._id, name: "Read Later", color: "#ffdd57" }
    ]);
  }
}

function scheduleUpdater() {
  cron.schedule(env.updateSchedule, async () => {
    const users = await User.find();
    for (const user of users) {
      await refreshAllFeedsForUser(user._id);
    }
  });
}

module.exports = {
  ensureDefaults,
  scheduleUpdater
};
