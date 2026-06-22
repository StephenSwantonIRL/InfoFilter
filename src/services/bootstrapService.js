const User = require("../models/User");
const Label = require("../models/Label");
const Plugin = require("../models/Plugin");
const Feed = require("../models/Feed");
const env = require("../config/env");
const { refreshFeed } = require("./feedService");

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
  setInterval(async () => {
    const now = new Date();
    const dueFeeds = await Feed.find({
      $or: [
        { nextRefreshAt: null },
        { nextRefreshAt: { $lte: now } }
      ]
    });

    for (const feed of dueFeeds) {
      try {
        await refreshFeed(feed);
      } catch (error) {
        feed.lastError = error.message;
        const retryAt = new Date();
        retryAt.setMinutes(retryAt.getMinutes() + env.minRefreshMinutes);
        feed.nextRefreshAt = retryAt;
        await feed.save();
      }
    }
  }, env.refreshSweepMs);
}

module.exports = {
  ensureDefaults,
  scheduleUpdater
};
