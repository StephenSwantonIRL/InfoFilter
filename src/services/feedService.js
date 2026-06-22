const Parser = require("rss-parser");
const crypto = require("crypto");
const Feed = require("../models/Feed");
const Filter = require("../models/Filter");
const Article = require("../models/Article");
const { applyFilters } = require("./filterService");
const { fetchSourceHtml, extractItemsWithRule, generateScraperCandidate } = require("./aiScraperService");
const env = require("../config/env");

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

function getRandomRefreshMinutes() {
  const min = Math.max(1, Math.min(env.minRefreshMinutes, env.maxRefreshMinutes));
  const max = Math.max(min, Math.max(env.minRefreshMinutes, env.maxRefreshMinutes));
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function computeNextRefreshAt() {
  const next = new Date();
  next.setMinutes(next.getMinutes() + getRandomRefreshMinutes());
  return next;
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

function mapAiItemToArticle(userId, feed, item) {
  const parsedPublishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
  const publishedAt = Number.isNaN(parsedPublishedAt.getTime()) ? new Date() : parsedPublishedAt;

  return {
    userId,
    feedId: feed._id,
    guid: item.link || `${item.title}-${publishedAt.toISOString()}`,
    title: item.title || "Untitled",
    link: item.link || "",
    author: "",
    content: item.summary || "",
    summary: item.summary || "",
    tags: [],
    labelIds: [],
    score: 0,
    publishedAt,
    importedAt: new Date(),
    updatedAtFeed: publishedAt,
    isRead: false,
    isStarred: false,
    isPublished: false,
    isArchived: false,
    note: ""
  };
}

async function createFeed({
  userId,
  title,
  feedUrl,
  siteUrl = "",
  categoryId = null,
  categoryIds = [],
  sourceType = "rss",
  aiConfig = null
}) {
  const normalizedCategoryIds = (categoryIds.length ? categoryIds : [categoryId])
    .filter(Boolean);
  const createdFeed = await Feed.create({
    userId,
    title,
    feedUrl,
    siteUrl,
    sourceType,
    categoryId,
    categoryIds: normalizedCategoryIds,
    aiConfig,
    generatedFeedKey: createKey(32),
    nextRefreshAt: computeNextRefreshAt()
  });

  return createdFeed;
}

async function importArticles(feed, items, mapItem) {
  const filters = await Filter.find({ userId: feed.userId }).lean();
  let importedCount = 0;

  for (const item of items) {
    const candidate = mapItem(feed.userId, feed, item);
    const { article, deleted } = await applyFilters(filters, candidate);
    if (deleted) continue;

    await Article.updateOne(
      { userId: feed.userId, feedId: feed._id, guid: article.guid },
      { $setOnInsert: article },
      { upsert: true }
    );
    importedCount += 1;
  }

  return importedCount;
}

async function refreshRssFeed(feed) {
  const parsed = await parser.parseURL(feed.feedUrl);
  const importedCount = await importArticles(feed, parsed.items || [], mapItemToArticle);

  feed.title = parsed.title || feed.title;
  feed.siteUrl = parsed.link || feed.siteUrl;
  feed.lastError = "";
  feed.lastUpdatedAt = new Date();
  feed.nextRefreshAt = computeNextRefreshAt();
  await feed.save();

  return { importedCount, title: feed.title };
}

async function repairAiFeedRule(feed, reason) {
  const candidate = await generateScraperCandidate({
    url: feed.feedUrl,
    guidance: feed.aiConfig?.guidance || "",
    previousRule: feed.aiConfig?.rule || null,
    repairReason: reason,
    fetchMode: feed.aiConfig?.fetchMode || "auto",
    waitUntil: feed.aiConfig?.waitUntil || "networkidle",
    waitForSelector: feed.aiConfig?.waitForSelector || "",
    waitAfterLoadMs: feed.aiConfig?.waitAfterLoadMs || 1500
  });

  feed.title = candidate.feedTitle || feed.title;
  feed.siteUrl = candidate.siteUrl || feed.siteUrl;
  feed.aiConfig = {
    ...(feed.aiConfig || {}),
    rule: candidate.rule,
    previewItems: candidate.previewItems,
    notes: candidate.notes,
    lastResolvedFetchMode: candidate.resolvedFetchMode || feed.aiConfig?.lastResolvedFetchMode || "",
    verificationStatus: "verified",
    lastRepairAt: new Date(),
    lastRepairReason: reason,
    repairCount: (feed.aiConfig?.repairCount || 0) + 1
  };

  await feed.save();
  return candidate;
}

async function refreshAiFeed(feed) {
  if (!feed.aiConfig?.rule?.itemSelector) {
    throw new Error("This AI source has no verified extraction rule yet.");
  }

  let fetchResult = await fetchSourceHtml(feed.feedUrl, {
    fetchMode: feed.aiConfig?.fetchMode || "auto",
    waitUntil: feed.aiConfig?.waitUntil || "networkidle",
    waitForSelector: feed.aiConfig?.waitForSelector || "",
    waitAfterLoadMs: feed.aiConfig?.waitAfterLoadMs || 1500
  });
  let candidate = extractItemsWithRule({
    url: feed.feedUrl,
    html: fetchResult.html,
    candidate: {
      feedTitle: feed.title,
      siteUrl: feed.siteUrl || feed.feedUrl,
      notes: feed.aiConfig.notes || "",
      rule: feed.aiConfig.rule
    }
  });

  if (!candidate.previewItems.length) {
    candidate = await repairAiFeedRule(feed, "Saved selector rule returned zero items.");
  }

  const importedCount = await importArticles(feed, candidate.previewItems, mapAiItemToArticle);
  feed.title = candidate.feedTitle || feed.title;
  feed.siteUrl = candidate.siteUrl || feed.siteUrl;
  feed.aiConfig = {
    ...(feed.aiConfig || {}),
    previewItems: candidate.previewItems,
    notes: candidate.notes || feed.aiConfig?.notes || "",
    lastResolvedFetchMode: candidate.resolvedFetchMode || fetchResult.resolvedFetchMode || feed.aiConfig?.lastResolvedFetchMode || "",
    verificationStatus: "verified"
  };
  feed.lastError = "";
  feed.lastUpdatedAt = new Date();
  feed.nextRefreshAt = computeNextRefreshAt();
  await feed.save();

  return { importedCount, title: feed.title };
}

async function refreshFeed(feed) {
  if (feed.sourceType === "ai_scraped") {
    return refreshAiFeed(feed);
  }

  return refreshRssFeed(feed);
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
      feed.nextRefreshAt = computeNextRefreshAt();
      await feed.save();
      results.push({ feedId: feed._id, error: error.message });
    }
  }

  return results;
}

module.exports = {
  createFeed,
  refreshFeed,
  refreshFeedById,
  refreshAllFeedsForUser
};
