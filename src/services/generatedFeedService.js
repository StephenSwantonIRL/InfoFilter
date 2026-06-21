const { Feed: AtomFeed } = require("feed");
const crypto = require("crypto");
const GeneratedFeed = require("../models/GeneratedFeed");
const Article = require("../models/Article");
const Feed = require("../models/Feed");
const Label = require("../models/Label");
const env = require("../config/env");

function createKey(length = 32) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

async function createGeneratedFeed(userId, scope, targetId, format = "atom") {
  const title = `Generated ${scope} feed`;
  return GeneratedFeed.findOneAndUpdate(
    { userId, scope, targetId },
    { userId, scope, targetId, title, format, key: createKey(32) },
    { upsert: true, new: true }
  );
}

async function resolveArticles(generatedFeed) {
  if (generatedFeed.scope === "feed") {
    return Article.find({ userId: generatedFeed.userId, feedId: generatedFeed.targetId }).sort({ publishedAt: -1 }).limit(30);
  }
  if (generatedFeed.scope === "label") {
    return Article.find({ userId: generatedFeed.userId, labelIds: generatedFeed.targetId }).sort({ publishedAt: -1 }).limit(30);
  }
  if (generatedFeed.scope === "special" && generatedFeed.targetId === "starred") {
    return Article.find({ userId: generatedFeed.userId, isStarred: true }).sort({ publishedAt: -1 }).limit(30);
  }

  return Article.find({ userId: generatedFeed.userId }).sort({ publishedAt: -1 }).limit(30);
}

async function renderGeneratedFeed(key) {
  const generatedFeed = await GeneratedFeed.findOne({ key });
  if (!generatedFeed) {
    throw new Error("Generated feed not found.");
  }

  const items = await resolveArticles(generatedFeed);
  const feedInfo = generatedFeed.scope === "feed"
    ? await Feed.findById(generatedFeed.targetId)
    : generatedFeed.scope === "label"
      ? await Label.findById(generatedFeed.targetId)
      : null;

  if (generatedFeed.format === "json") {
    return {
      contentType: "application/json",
      body: JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        title: generatedFeed.title,
        home_page_url: env.baseUrl,
        feed_url: `${env.baseUrl}/public/feeds/${generatedFeed.key}`,
        items: items.map((article) => ({
          id: String(article._id),
          url: article.link,
          title: article.title,
          content_html: article.content,
          summary: article.summary,
          date_published: article.publishedAt.toISOString()
        }))
      }, null, 2)
    };
  }

  const atom = new AtomFeed({
    id: `${env.baseUrl}/public/feeds/${generatedFeed.key}`,
    title: generatedFeed.title,
    link: env.baseUrl,
    description: feedInfo?.title || generatedFeed.title
  });

  items.forEach((article) => {
    atom.addItem({
      id: String(article._id),
      title: article.title,
      link: article.link,
      content: article.content,
      description: article.summary,
      date: article.publishedAt
    });
  });

  return {
    contentType: "application/atom+xml",
    body: atom.atom1()
  };
}

module.exports = {
  createGeneratedFeed,
  renderGeneratedFeed
};
