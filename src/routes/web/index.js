const express = require("express");
const User = require("../../models/User");
const Feed = require("../../models/Feed");
const FeedCategory = require("../../models/FeedCategory");
const Article = require("../../models/Article");
const Label = require("../../models/Label");
const Filter = require("../../models/Filter");
const GeneratedFeed = require("../../models/GeneratedFeed");
const Plugin = require("../../models/Plugin");
const { requireAuth, requireAdmin } = require("../../middleware/auth");
const { createFeed, refreshFeedById } = require("../../services/feedService");
const { applyFilters, matchesFilter } = require("../../services/filterService");
const { importOpml, exportOpml } = require("../../services/opmlService");
const { createGeneratedFeed, renderGeneratedFeed } = require("../../services/generatedFeedService");
const env = require("../../config/env");

const router = express.Router();

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getFeedCategoryIds(feed) {
  if (feed.categoryIds?.length) return feed.categoryIds.map(String);
  if (feed.categoryId) return [String(feed.categoryId)];
  return [];
}

function buildArticleQueryForView({ userId, selectedFeedId, selectedLabelId, selectedSpecial, selectedCategoryId, unreadOnly, feeds }) {
  const articleQuery = { userId };

  if (selectedCategoryId) {
    const categoryFeedIds = feeds
      .filter((feed) => getFeedCategoryIds(feed).includes(String(selectedCategoryId)))
      .map((feed) => feed._id);
    articleQuery.feedId = { $in: categoryFeedIds };
  } else if (selectedFeedId) {
    articleQuery.feedId = selectedFeedId;
  }

  if (selectedLabelId) {
    articleQuery.labelIds = selectedLabelId;
  }

  if (selectedSpecial === "starred") {
    articleQuery.isStarred = true;
  }

  if (unreadOnly) {
    articleQuery.isRead = false;
  }

  return articleQuery;
}

function buildViewQueryString({ selectedFeedId, selectedLabelId, selectedSpecial, selectedCategoryId, unreadOnly }) {
  const params = new URLSearchParams();
  if (selectedFeedId) params.set("feed", selectedFeedId);
  if (selectedLabelId) params.set("label", selectedLabelId);
  if (selectedSpecial) params.set("special", selectedSpecial);
  if (selectedCategoryId) params.set("category", selectedCategoryId);
  if (unreadOnly) params.set("unread", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

function buildFilterPayload(req) {
  const actionValue = req.body.actionType === "label" ? req.body.labelActionValue : (req.body.actionValue || "");
  return {
    caption: req.body.caption || "Preview Filter",
    enabled: req.body.enabled !== "off",
    matchMode: req.body.matchMode || "all",
    inverse: req.body.inverse === "on",
    order: Number(req.body.order || 0),
    rules: [{
      field: req.body.ruleField,
      pattern: req.body.rulePattern,
      inverse: req.body.ruleInverse === "on"
    }],
    actions: [{
      type: req.body.actionType,
      value: actionValue
    }]
  };
}

function buildFilterDraft(req) {
  return {
    sourceFilterId: req.body.sourceFilterId || "",
    caption: req.body.caption || "",
    enabled: req.body.enabled !== "off",
    ruleField: req.body.ruleField || "title",
    rulePattern: req.body.rulePattern || "",
    actionType: req.body.actionType || "markRead",
    actionValue: req.body.actionValue || "",
    labelActionValue: req.body.labelActionValue || "",
    matchMode: req.body.matchMode || "all"
  };
}

function summarizePreviewChanges(beforeArticle, afterArticle, deleted) {
  const changes = [];
  if (deleted) changes.push("Would be deleted");
  if (!beforeArticle.isRead && afterArticle.isRead) changes.push("Would be marked read");
  if (!beforeArticle.isStarred && afterArticle.isStarred) changes.push("Would be starred");
  if (!beforeArticle.isPublished && afterArticle.isPublished) changes.push("Would be published");
  if (afterArticle.score !== beforeArticle.score) changes.push(`Score ${beforeArticle.score} -> ${afterArticle.score}`);
  if ((afterArticle.tags || []).length > (beforeArticle.tags || []).length) changes.push("Would gain tags");
  if ((afterArticle.labelIds || []).length > (beforeArticle.labelIds || []).length) changes.push("Would gain labels");
  return changes;
}

async function renderPreferences(req, res, extras = {}) {
  const [labels, filters, plugins, generatedFeeds] = await Promise.all([
    Label.find({ userId: req.currentUser._id }).lean(),
    Filter.find({ userId: req.currentUser._id }).sort({ order: 1 }).lean(),
    Plugin.find().lean(),
    GeneratedFeed.find({ userId: req.currentUser._id }).lean()
  ]);

  return res.render("prefs/index", {
    title: "Preferences",
    currentUser: req.currentUser,
    labels,
    filters,
    plugins,
    generatedFeeds,
    previewResults: null,
    filterDraft: null,
    ...extras
  });
}

router.get("/public/feeds/:key", async (req, res, next) => {
  try {
    const output = await renderGeneratedFeed(req.params.key);
    res.setHeader("Content-Type", output.contentType);
    return res.send(output.body);
  } catch (error) {
    return next(error);
  }
});

router.get("/", requireAuth, async (req, res) => {
  const selectedFeedId = req.query.feed || null;
  const selectedLabelId = req.query.label || null;
  const selectedSpecial = req.query.special || null;
  const selectedCategoryId = req.query.category || null;
  const unreadOnly = req.query.unread === "1";
  const [feeds, categories, labels, selectedFeed, selectedLabel, selectedCategory] = await Promise.all([
    Feed.find({ userId: req.currentUser._id }).sort({ title: 1 }).lean(),
    FeedCategory.find({ userId: req.currentUser._id }).sort({ name: 1 }).lean(),
    Label.find({ userId: req.currentUser._id }).sort({ name: 1 }).lean(),
    selectedFeedId ? Feed.findOne({ _id: selectedFeedId, userId: req.currentUser._id }).lean() : null,
    selectedLabelId ? Label.findOne({ _id: selectedLabelId, userId: req.currentUser._id }).lean() : null,
    selectedCategoryId ? FeedCategory.findOne({ _id: selectedCategoryId, userId: req.currentUser._id }).lean() : null
  ]);

  const articleQuery = buildArticleQueryForView({
    userId: req.currentUser._id,
    selectedFeedId,
    selectedLabelId,
    selectedSpecial,
    selectedCategoryId,
    unreadOnly,
    feeds
  });

  const [articles] = await Promise.all([
    Article.find(articleQuery).sort({ publishedAt: -1 }).limit(50).populate("feedId labelIds").lean(),
  ]);

  return res.render("reader/index", {
    title: env.appName,
    currentUser: req.currentUser,
    feeds,
    categories,
    labels,
    articles,
    selectedFeedId,
    selectedFeed,
    selectedLabelId,
    selectedLabel,
    selectedSpecial,
    selectedCategoryId,
    selectedCategory,
    getFeedCategoryIds,
    viewQueryString: buildViewQueryString({ selectedFeedId, selectedLabelId, selectedSpecial, selectedCategoryId, unreadOnly }),
    unreadOnly,
    toggleUnreadViewQueryString: buildViewQueryString({
      selectedFeedId,
      selectedLabelId,
      selectedSpecial,
      selectedCategoryId,
      unreadOnly: !unreadOnly
    })
  });
});

router.get("/login", (_req, res) => {
  res.render("auth/login", { title: "Login", currentUser: null, error: null });
});

router.post("/login", async (req, res) => {
  const user = await User.findOne({ email: req.body.email.toLowerCase() });
  if (!user || !(await user.verifyPassword(req.body.password))) {
    return res.status(401).render("auth/login", { title: "Login", currentUser: null, error: "Invalid credentials." });
  }

  req.session.user = {
    _id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    preferences: user.preferences
  };

  return res.redirect("/");
});

router.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

router.post("/feeds", requireAuth, async (req, res) => {
  const categoryIds = normalizeArray(req.body.categoryIds);
  const feed = await createFeed({
    userId: req.currentUser._id,
    title: req.body.title,
    feedUrl: req.body.feedUrl,
    siteUrl: req.body.siteUrl,
    categoryId: categoryIds[0] || null,
    categoryIds
  });

  try {
    await refreshFeedById(feed._id, req.currentUser._id);
  } catch (_error) {
    // Allow subscription to succeed even if the first refresh fails.
  }

  return res.redirect(`/?feed=${feed._id}`);
});

router.post("/feeds/:id", requireAuth, async (req, res) => {
  const categoryIds = normalizeArray(req.body.categoryIds);
  await Feed.updateOne(
    { _id: req.params.id, userId: req.currentUser._id },
    {
      $set: {
        title: req.body.title,
        feedUrl: req.body.feedUrl,
        siteUrl: req.body.siteUrl,
        categoryId: categoryIds[0] || null,
        categoryIds
      }
    }
  );

  return res.redirect(`/?feed=${req.params.id}`);
});

router.post("/feeds/:id/refresh", requireAuth, async (req, res) => {
  await refreshFeedById(req.params.id, req.currentUser._id);
  return res.redirect(req.get("referer") || `/?feed=${req.params.id}`);
});

router.delete("/feeds/:id", requireAuth, async (req, res) => {
  await Feed.deleteOne({ _id: req.params.id, userId: req.currentUser._id });
  await Article.deleteMany({ feedId: req.params.id, userId: req.currentUser._id });
  return res.redirect("/");
});

router.post("/categories", requireAuth, async (req, res) => {
  await FeedCategory.create({
    userId: req.currentUser._id,
    name: req.body.name,
    parentId: req.body.parentId || null
  });
  return res.redirect("/");
});

router.get("/articles/:id", requireAuth, async (req, res) => {
  const selectedFeedId = req.query.feed || null;
  const selectedLabelId = req.query.label || null;
  const selectedSpecial = req.query.special || null;
  const selectedCategoryId = req.query.category || null;
  const unreadOnly = req.query.unread === "1";

  await Article.updateOne(
    { _id: req.params.id, userId: req.currentUser._id, isRead: false },
    { $set: { isRead: true } }
  );

  const [article, availableLabels, feeds] = await Promise.all([
    Article.findOne({ _id: req.params.id, userId: req.currentUser._id }).populate("feedId labelIds").lean(),
    Label.find({ userId: req.currentUser._id }).sort({ name: 1 }).lean(),
    Feed.find({ userId: req.currentUser._id }).lean()
  ]);

  if (!article) {
    return res.status(404).render("reader/error", { title: "Not Found", currentUser: req.currentUser, error: "Article not found." });
  }

  const articleQuery = buildArticleQueryForView({
    userId: req.currentUser._id,
    selectedFeedId,
    selectedLabelId,
    selectedSpecial,
    selectedCategoryId,
    unreadOnly,
    feeds
  });

  const viewArticles = await Article.find(articleQuery)
    .sort({ publishedAt: -1 })
    .select("_id title")
    .lean();

  const currentIndex = viewArticles.findIndex((item) => String(item._id) === String(article._id));
  const previousArticle = currentIndex > 0 ? viewArticles[currentIndex - 1] : null;
  const nextArticle = currentIndex >= 0 && currentIndex < viewArticles.length - 1 ? viewArticles[currentIndex + 1] : null;
  const viewQueryString = buildViewQueryString({ selectedFeedId, selectedLabelId, selectedSpecial, selectedCategoryId, unreadOnly });

  return res.render("reader/article", {
    title: article.title,
    currentUser: req.currentUser,
    article,
    availableLabels,
    previousArticle,
    nextArticle,
    backToListUrl: `/${viewQueryString}`,
    viewQueryString
  });
});

router.post("/articles/:id/state", requireAuth, async (req, res) => {
  const update = {};
  if ("isRead" in req.body) update.isRead = req.body.isRead === "true";
  if ("isStarred" in req.body) update.isStarred = req.body.isStarred === "true";
  if ("isPublished" in req.body) update.isPublished = req.body.isPublished === "true";
  if ("isArchived" in req.body) update.isArchived = req.body.isArchived === "true";
  if ("note" in req.body) update.note = req.body.note;
  await Article.updateOne({ _id: req.params.id, userId: req.currentUser._id }, { $set: update });
  return res.redirect(req.get("referer") || "/");
});

router.post("/articles/:id/labels", requireAuth, async (req, res) => {
  const labelId = req.body.labelId;
  if (labelId) {
    await Article.updateOne(
      { _id: req.params.id, userId: req.currentUser._id },
      { $addToSet: { labelIds: labelId } }
    );
  }
  return res.redirect(req.get("referer") || `/articles/${req.params.id}`);
});

router.post("/articles/:id/labels/:labelId/remove", requireAuth, async (req, res) => {
  await Article.updateOne(
    { _id: req.params.id, userId: req.currentUser._id },
    { $pull: { labelIds: req.params.labelId } }
  );
  return res.redirect(req.get("referer") || `/articles/${req.params.id}`);
});

router.get("/prefs", requireAuth, async (req, res) => {
  return renderPreferences(req, res);
});

router.post("/prefs/account", requireAuth, async (req, res) => {
  await User.updateOne(
    { _id: req.currentUser._id },
    {
      $set: {
        displayName: req.body.displayName,
        preferences: {
          theme: req.body.theme || "light",
          digestEnabled: req.body.digestEnabled === "on",
          unreadOnly: req.body.unreadOnly === "on",
          sortOrder: req.body.sortOrder || "newest",
          articleView: req.body.articleView || "adaptive"
        }
      }
    }
  );

  const freshUser = await User.findById(req.currentUser._id);
  req.session.user = {
    _id: String(freshUser._id),
    email: freshUser.email,
    displayName: freshUser.displayName,
    role: freshUser.role,
    preferences: freshUser.preferences
  };

  return res.redirect("/prefs");
});

router.post("/prefs/labels", requireAuth, async (req, res) => {
  await Label.create({
    userId: req.currentUser._id,
    name: req.body.name,
    color: req.body.color
  });
  return res.redirect("/prefs");
});

router.post("/prefs/filters", requireAuth, async (req, res) => {
  const filterPayload = buildFilterPayload(req);
  await Filter.create({
    userId: req.currentUser._id,
    ...filterPayload
  });
  return res.redirect("/prefs");
});

router.post("/prefs/filters/preview", requireAuth, async (req, res) => {
  const filterPayload = buildFilterPayload(req);
  const filterDraft = buildFilterDraft(req);
  const articles = await Article.find({ userId: req.currentUser._id })
    .sort({ publishedAt: -1 })
    .limit(200)
    .populate("feedId labelIds")
    .lean();

  const matchedArticles = [];
  for (const article of articles) {
    if (!matchesFilter(filterPayload, article)) continue;
    const preview = await applyFilters([{ ...filterPayload, userId: req.currentUser._id }], article);
    matchedArticles.push({
      article,
      changes: summarizePreviewChanges(article, preview.article, preview.deleted),
      deleted: preview.deleted
    });
  }

  return renderPreferences(req, res, {
    previewResults: {
      filter: filterPayload,
      matchedCount: matchedArticles.length,
      scannedCount: articles.length,
      matches: matchedArticles.slice(0, 25)
    },
    filterDraft
  });
});

router.post("/prefs/filters/:id", requireAuth, async (req, res) => {
  const filterPayload = buildFilterPayload(req);
  await Filter.updateOne(
    { _id: req.params.id, userId: req.currentUser._id },
    {
      $set: {
        ...filterPayload
      }
    }
  );
  return res.redirect("/prefs");
});

router.post("/prefs/filters/:id/delete", requireAuth, async (req, res) => {
  await Filter.deleteOne({ _id: req.params.id, userId: req.currentUser._id });
  return res.redirect("/prefs");
});

router.post("/prefs/filters/:id/toggle", requireAuth, async (req, res) => {
  const filter = await Filter.findOne({ _id: req.params.id, userId: req.currentUser._id });
  if (filter) {
    filter.enabled = !filter.enabled;
    await filter.save();
  }
  return res.redirect("/prefs");
});

router.post("/prefs/opml/import", requireAuth, async (req, res) => {
  if (!req.body.opml) {
    return res.redirect("/prefs");
  }

  await importOpml(req.body.opml, req.currentUser._id);
  return res.redirect("/");
});

router.get("/prefs/opml/export", requireAuth, async (req, res) => {
  const [categories, feeds] = await Promise.all([
    FeedCategory.find({ userId: req.currentUser._id }).lean(),
    Feed.find({ userId: req.currentUser._id }).lean()
  ]);

  const xml = exportOpml(categories, feeds);
  res.setHeader("Content-Type", "text/xml");
  res.setHeader("Content-Disposition", "attachment; filename=feeds.opml");
  return res.send(xml);
});

router.post("/prefs/generated-feeds", requireAuth, async (req, res) => {
  await createGeneratedFeed(req.currentUser._id, req.body.scope, req.body.targetId, req.body.format);
  return res.redirect("/prefs");
});

router.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  const [users, feeds, articles] = await Promise.all([
    User.find().lean(),
    Feed.countDocuments(),
    Article.countDocuments()
  ]);

  return res.render("admin/index", {
    title: "Admin",
    currentUser: req.currentUser,
    users,
    feedCount: feeds,
    articleCount: articles
  });
});

module.exports = router;
