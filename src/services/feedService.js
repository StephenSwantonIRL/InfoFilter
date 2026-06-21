const Parser = require("rss-parser");
const crypto = require("crypto");
const Feed = require("../models/Feed");
const Filter = require("../models/Filter");
const Article = require("../models/Article");
const { applyFilters } = require("./filterService");

const parser = new Parser({
  customFields: {
    item: ["media:content", "content:encoded"]
  }
});

function deriveGuid(item) {
  return item.guid || item.id || item.link || `${item.title}-${item.pubDate || ""}`;
}

function createKey(length = 32) {
  return crypto.randomBytes(length).toString("base64url").slice(0, length);
}

function mapItemToArticle(userId, feed, item) {
  return {
    userId,
    feedId: feed._id,
    guid: deriveGuid(item),
    title: item.title || "Untitled",
    link: item.link || "",
    author: item.creator || item.author || "",
    content: item["content:encoded"] || item.content || item.contentSnippet || "",
    summary: item.contentSnippet || "",
    tags: (item.categories || []).filter(Boolean),
    labelIds: [],
    score: 0,
    publishedAt: item.isoDate ? new Date(item.isoDate) : new Date(),
    importedAt: new Date(),
    updatedAtFeed: item.isoDate ? new Date(item.isoDate) : new Date(),
    isRead: false,
    isStarred: false,
    isPublished: false,
    isArchived: false,
    note: ""
  };
}

async function createFeed({ userId, title, feedUrl, siteUrl = "", categoryId = null, categoryIds = [] }) {
  const normalizedCategoryIds = (categoryIds.length ? categoryIds : [categoryId])
    .filter(Boolean);
  const createdFeed = await Feed.create({
    userId,
    title,
    feedUrl,
    siteUrl,
    categoryId,
    categoryIds: normalizedCategoryIds,
    generatedFeedKey: createKey(32)
  });

  return createdFeed;
}

async function refreshFeed(feed) {
  const parsed = await parser.parseURL(feed.feedUrl);
  const filters = await Filter.find({ userId: feed.userId }).lean();
  let importedCount = 0;

  for (const item of parsed.items || []) {
    const candidate = mapItemToArticle(feed.userId, feed, item);
    const { article, deleted } = await applyFilters(filters, candidate);
    if (deleted) continue;

    await Article.updateOne(
      { userId: feed.userId, feedId: feed._id, guid: article.guid },
      { $setOnInsert: article },
      { upsert: true }
    );
    importedCount += 1;
  }

  feed.title = parsed.title || feed.title;
  feed.siteUrl = parsed.link || feed.siteUrl;
  feed.lastError = "";
  feed.lastUpdatedAt = new Date();
  await feed.save();

  return { importedCount, title: feed.title };
}

async function refreshFeedById(feedId, userId) {
  const feed = await Feed.findOne({ _id: feedId, userId });
  if (!feed) {
    throw new Error("Feed not found.");
  }

  return refreshFeed(feed);
}

async function refreshAllFeedsForUser(userId) {
  const feeds = await Feed.find({ userId });
  const results = [];

  for (const feed of feeds) {
    try {
      const result = await refreshFeed(feed);
      results.push({ feedId: feed._id, ...result });
    } catch (error) {
      feed.lastError = error.message;
      await feed.save();
      results.push({ feedId: feed._id, error: error.message });
    }
  }

  return results;
}

module.exports = {
  createFeed,
  refreshFeedById,
  refreshAllFeedsForUser
};
