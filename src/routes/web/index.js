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
const { fetchSourceHtml, generateScraperCandidate } = require("../../services/aiScraperService");
const { fetchMatchingNewsletterMessages, extractNewsletterItems } = require("../../services/newsletterService");
const { fetchBlueskyAuthorFeed, normalizeHandle } = require("../../services/blueskyService");
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

function buildViewState(req) {
  return {
    selectedFeedId: req.query.feed || null,
    selectedLabelId: req.query.label || null,
    selectedSpecial: req.query.special || null,
    selectedCategoryId: req.query.category || null,
    unreadOnly: req.query.unread === "1"
  };
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

function buildAiSourceDraft(req) {
  return {
    feedId: req.body.feedId || "",
    title: req.body.title || "",
    sourceUrl: req.body.sourceUrl || "",
    guidance: req.body.guidance || "",
    categoryIds: normalizeArray(req.body.categoryIds).map(String),
    fetchMode: req.body.fetchMode || "auto",
    waitUntil: req.body.waitUntil || "networkidle",
    waitForSelector: req.body.waitForSelector || "",
    waitAfterLoadMs: Number(req.body.waitAfterLoadMs || 1500)
  };
}

function buildNewsletterSourceDraft(req) {
  return {
    feedId: req.body.feedId || "",
    title: req.body.title || "",
    senderPattern: req.body.senderPattern || "",
    subjectPattern: req.body.subjectPattern || "",
    forwardedByPattern: req.body.forwardedByPattern || "",
    mailbox: req.body.mailbox || env.imapMailbox || "INBOX",
    guidance: req.body.guidance || "",
    categoryIds: normalizeArray(req.body.categoryIds).map(String)
  };
}

function buildBlueskySourceDraft(req) {
  return {
    feedId: req.body.feedId || "",
    title: req.body.title || "",
    handle: normalizeHandle(req.body.handle || ""),
    includeReplies: req.body.includeReplies === "on",
    includeReposts: req.body.includeReposts === "on",
    categoryIds: normalizeArray(req.body.categoryIds).map(String)
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
  const [labels, filters, plugins, generatedFeeds, aiSources, newsletterSources, blueskySources, categories] = await Promise.all([
    Label.find({ userId: req.currentUser._id }).lean(),
    Filter.find({ userId: req.currentUser._id }).sort({ order: 1 }).lean(),
    Plugin.find().lean(),
    GeneratedFeed.find({ userId: req.currentUser._id }).lean(),
    Feed.find({ userId: req.currentUser._id, sourceType: "ai_scraped" }).sort({ updatedAt: -1 }).lean(),
    Feed.find({ userId: req.currentUser._id, sourceType: "newsletter" }).sort({ updatedAt: -1 }).lean(),
    Feed.find({ userId: req.currentUser._id, sourceType: "bluesky" }).sort({ updatedAt: -1 }).lean(),
    FeedCategory.find({ userId: req.currentUser._id }).sort({ name: 1 }).lean()
  ]);

  return res.render("prefs/index", {
    title: "Preferences",
    currentUser: req.currentUser,
    getFeedCategoryIds,
    labels,
    filters,
    plugins,
    generatedFeeds,
    aiSources,
    newsletterSources,
    blueskySources,
    categories,
    hasOpenAIConfig: Boolean(env.openaiApiKey),
    hasImapConfig: Boolean(env.imapHost && env.imapUser && env.imapPassword),
    aiSourceError: null,
    newsletterSourceError: null,
    blueskySourceError: null,
    previewResults: null,
    filterDraft: null,
    aiSourceDraft: req.session.aiSourceDraft || null,
    newsletterSourceDraft: req.session.newsletterSourceDraft || null,
    blueskySourceDraft: req.session.blueskySourceDraft || null,
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
  const { selectedFeedId, selectedLabelId, selectedSpecial, selectedCategoryId, unreadOnly } = buildViewState(req);
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

router.post("/articles/mark-all-read", requireAuth, async (req, res) => {
  const viewState = {
    selectedFeedId: req.body.feed || null,
    selectedLabelId: req.body.label || null,
    selectedSpecial: req.body.special || null,
    selectedCategoryId: req.body.category || null,
    unreadOnly: req.body.unread === "1"
  };

  const feeds = await Feed.find({ userId: req.currentUser._id }).lean();
  const articleQuery = buildArticleQueryForView({
    userId: req.currentUser._id,
    ...viewState,
    feeds
  });

  await Article.updateMany(articleQuery, { $set: { isRead: true } });
  const viewQueryString = buildViewQueryString(viewState);
  return res.redirect(`/${viewQueryString}`);
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
  const existingFeed = await Feed.findOne({ _id: req.params.id, userId: req.currentUser._id });
  if (!existingFeed) {
    return res.status(404).render("reader/error", { title: "Not Found", currentUser: req.currentUser, error: "Feed not found." });
  }

  await Feed.updateOne(
    { _id: req.params.id, userId: req.currentUser._id },
    {
      $set: {
        title: req.body.title,
        feedUrl: existingFeed.sourceType === "newsletter"
          ? existingFeed.feedUrl
          : existingFeed.sourceType === "bluesky"
            ? `bluesky://${normalizeHandle(req.body.blueskyHandle || existingFeed.blueskyConfig?.handle || "")}`
            : req.body.feedUrl,
        siteUrl: req.body.siteUrl,
        categoryId: categoryIds[0] || null,
        categoryIds,
        aiConfig: existingFeed.sourceType === "ai_scraped"
          ? {
              ...(existingFeed.aiConfig || {}),
              guidance: req.body.aiGuidance || existingFeed.aiConfig?.guidance || "",
              fetchMode: req.body.aiFetchMode || existingFeed.aiConfig?.fetchMode || "auto",
              waitUntil: req.body.aiWaitUntil || existingFeed.aiConfig?.waitUntil || "networkidle",
              waitForSelector: req.body.aiWaitForSelector || existingFeed.aiConfig?.waitForSelector || "",
              waitAfterLoadMs: Number(req.body.aiWaitAfterLoadMs || existingFeed.aiConfig?.waitAfterLoadMs || 1500)
            }
          : existingFeed.aiConfig || null,
        newsletterConfig: existingFeed.sourceType === "newsletter"
          ? {
              ...(existingFeed.newsletterConfig || {}),
              senderPattern: req.body.newsletterSenderPattern || existingFeed.newsletterConfig?.senderPattern || "",
              subjectPattern: req.body.newsletterSubjectPattern || existingFeed.newsletterConfig?.subjectPattern || "",
              forwardedByPattern: req.body.newsletterForwardedByPattern || existingFeed.newsletterConfig?.forwardedByPattern || "",
              mailbox: req.body.newsletterMailbox || existingFeed.newsletterConfig?.mailbox || env.imapMailbox || "INBOX",
              guidance: req.body.newsletterGuidance || existingFeed.newsletterConfig?.guidance || ""
            }
          : existingFeed.newsletterConfig || null,
        blueskyConfig: existingFeed.sourceType === "bluesky"
          ? {
              ...(existingFeed.blueskyConfig || {}),
              handle: normalizeHandle(req.body.blueskyHandle || existingFeed.blueskyConfig?.handle || ""),
              includeReplies: req.body.blueskyIncludeReplies === "on",
              includeReposts: req.body.blueskyIncludeReposts === "on"
            }
          : existingFeed.blueskyConfig || null
      }
    }
  );

  return res.redirect(`/?feed=${req.params.id}`);
});

router.post("/feeds/:id/refresh", requireAuth, async (req, res) => {
  await refreshFeedById(req.params.id, req.currentUser._id);
  return res.redirect(req.get("referer") || `/?feed=${req.params.id}`);
});

router.post("/feeds/:id/ai-repair", requireAuth, async (req, res) => {
  try {
    const feed = await Feed.findOne({ _id: req.params.id, userId: req.currentUser._id, sourceType: "ai_scraped" });
    if (!feed) {
      return res.status(404).render("reader/error", { title: "Not Found", currentUser: req.currentUser, error: "AI source not found." });
    }

    const guidance = req.body.guidance || feed.aiConfig?.guidance || "";
    const candidate = await generateScraperCandidate({
      url: feed.feedUrl,
      guidance,
      previousRule: feed.aiConfig?.rule || null,
      repairReason: "Manual user-triggered repair.",
      fetchMode: req.body.fetchMode || feed.aiConfig?.fetchMode || "auto",
      waitUntil: req.body.waitUntil || feed.aiConfig?.waitUntil || "networkidle",
      waitForSelector: req.body.waitForSelector || feed.aiConfig?.waitForSelector || "",
      waitAfterLoadMs: Number(req.body.waitAfterLoadMs || feed.aiConfig?.waitAfterLoadMs || 1500)
    });

    req.session.aiSourceDraft = {
      feedId: String(feed._id),
      title: feed.title,
      sourceUrl: feed.feedUrl,
      guidance,
      categoryIds: getFeedCategoryIds(feed),
      fetchMode: req.body.fetchMode || feed.aiConfig?.fetchMode || "auto",
      waitUntil: req.body.waitUntil || feed.aiConfig?.waitUntil || "networkidle",
      waitForSelector: req.body.waitForSelector || feed.aiConfig?.waitForSelector || "",
      waitAfterLoadMs: Number(req.body.waitAfterLoadMs || feed.aiConfig?.waitAfterLoadMs || 1500),
      candidate,
      debug: candidate.debug || null
    };

    return renderPreferences(req, res, {
      aiSourceDraft: req.session.aiSourceDraft
    });
  } catch (error) {
    const draft = buildAiSourceDraft(req);
    req.session.aiSourceDraft = {
      ...draft,
      title: req.body.title || "",
      candidate: error.candidate || null,
      debug: error.debug || null
    };

    return renderPreferences(req, res, {
      aiSourceError: error.message,
      aiSourceDraft: req.session.aiSourceDraft
    });
  }
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

  if (unreadOnly) {
    delete articleQuery.isRead;
  }

  const viewArticles = await Article.find(articleQuery)
    .sort({ publishedAt: -1 })
    .select("_id title isRead")
    .lean();

  const effectiveViewArticles = unreadOnly
    ? viewArticles.filter((item) => String(item._id) === String(article._id) || item.isRead === false)
    : viewArticles;

  const currentIndex = effectiveViewArticles.findIndex((item) => String(item._id) === String(article._id));
  const previousArticle = currentIndex > 0 ? effectiveViewArticles[currentIndex - 1] : null;
  const nextArticle = currentIndex >= 0 && currentIndex < effectiveViewArticles.length - 1 ? effectiveViewArticles[currentIndex + 1] : null;
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

router.get("/prefs/ai-sources/debug-source", requireAuth, async (req, res) => {
  const draft = req.session.aiSourceDraft;
  if (!draft?.sourceUrl) {
    return res.status(400).render("reader/error", {
      title: "Debug Source Unavailable",
      currentUser: req.currentUser,
      error: "Generate an AI source preview first so there is a source URL and fetch configuration to inspect."
    });
  }

  try {
    const fetchResult = await fetchSourceHtml(draft.sourceUrl, {
      fetchMode: draft.fetchMode || "auto",
      waitUntil: draft.waitUntil || "networkidle",
      waitForSelector: draft.waitForSelector || "",
      waitAfterLoadMs: Number(draft.waitAfterLoadMs || 1500)
    });

    return res.render("prefs/ai-source-debug", {
      title: "Fetched Source Debug",
      currentUser: req.currentUser,
      sourceUrl: draft.sourceUrl,
      finalUrl: fetchResult.finalUrl || draft.sourceUrl,
      requestedFetchMode: draft.fetchMode || "auto",
      resolvedFetchMode: fetchResult.resolvedFetchMode || draft.fetchMode || "auto",
      waitUntil: draft.waitUntil || "networkidle",
      waitForSelector: draft.waitForSelector || "",
      waitAfterLoadMs: Number(draft.waitAfterLoadMs || 1500),
      fetchedHtml: fetchResult.html || ""
    });
  } catch (error) {
    return res.status(500).render("reader/error", {
      title: "Debug Source Failed",
      currentUser: req.currentUser,
      error: error.message
    });
  }
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

router.post("/prefs/ai-sources/preview", requireAuth, async (req, res) => {
  try {
    const draft = buildAiSourceDraft(req);
    const existingFeedId = draft.feedId;

    const existingFeed = existingFeedId
      ? await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id, sourceType: "ai_scraped" })
      : null;

    const candidate = await generateScraperCandidate({
      url: draft.sourceUrl,
      guidance: draft.guidance,
      previousRule: existingFeed?.aiConfig?.rule || null,
      repairReason: existingFeed ? "Refreshing candidate during setup or repair." : "",
      fetchMode: draft.fetchMode,
      waitUntil: draft.waitUntil,
      waitForSelector: draft.waitForSelector,
      waitAfterLoadMs: draft.waitAfterLoadMs
    });

    req.session.aiSourceDraft = {
      feedId: existingFeedId,
      title: draft.title || existingFeed?.title || candidate.feedTitle,
      sourceUrl: draft.sourceUrl,
      guidance: draft.guidance,
      categoryIds: draft.categoryIds,
      fetchMode: draft.fetchMode,
      waitUntil: draft.waitUntil,
      waitForSelector: draft.waitForSelector,
      waitAfterLoadMs: draft.waitAfterLoadMs,
      candidate,
      debug: candidate.debug || null
    };

    return renderPreferences(req, res, {
      aiSourceDraft: req.session.aiSourceDraft
    });
  } catch (error) {
    const draft = buildAiSourceDraft(req);
    req.session.aiSourceDraft = {
      ...draft,
      candidate: error.candidate || null,
      debug: error.debug || null
    };

    return renderPreferences(req, res, {
      aiSourceError: error.message,
      aiSourceDraft: req.session.aiSourceDraft
    });
  }
});

router.post("/prefs/ai-sources/discard", requireAuth, async (req, res) => {
  delete req.session.aiSourceDraft;
  return res.redirect("/prefs");
});

router.post("/prefs/ai-sources/confirm", requireAuth, async (req, res) => {
  const draft = req.session.aiSourceDraft;
  if (!draft?.candidate) {
    return res.redirect("/prefs");
  }

  const existingFeedId = draft.feedId || "";
  const feedPayload = {
    title: draft.title || draft.candidate.feedTitle || draft.sourceUrl,
    feedUrl: draft.sourceUrl,
    siteUrl: draft.candidate.siteUrl || draft.sourceUrl,
    categoryId: draft.categoryIds?.[0] || null,
    categoryIds: draft.categoryIds || [],
    sourceType: "ai_scraped",
    aiConfig: {
      guidance: draft.guidance || "",
      notes: draft.candidate.notes || "",
      fetchMode: draft.fetchMode || "auto",
      waitUntil: draft.waitUntil || "networkidle",
      waitForSelector: draft.waitForSelector || "",
      waitAfterLoadMs: Number(draft.waitAfterLoadMs || 1500),
      lastResolvedFetchMode: draft.candidate.resolvedFetchMode || "",
      rule: draft.candidate.rule,
      previewItems: draft.candidate.previewItems,
      verificationStatus: "verified",
      lastVerifiedAt: new Date(),
      lastRepairAt: existingFeedId ? new Date() : null,
      lastRepairReason: existingFeedId ? "User confirmed repaired AI rule." : "",
      repairCount: existingFeedId ? 1 : 0
    }
  };

  let feed;
  if (existingFeedId) {
    await Feed.updateOne(
      { _id: existingFeedId, userId: req.currentUser._id },
      { $set: feedPayload }
    );
    feed = await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id });
  } else {
    feed = await createFeed({
      userId: req.currentUser._id,
      ...feedPayload
    });
  }

  delete req.session.aiSourceDraft;
  await refreshFeedById(feed._id, req.currentUser._id);
  return res.redirect(`/?feed=${feed._id}`);
});

router.post("/prefs/newsletter-sources/preview", requireAuth, async (req, res) => {
  try {
    const draft = buildNewsletterSourceDraft(req);
    if (!draft.senderPattern && !draft.subjectPattern && !draft.forwardedByPattern) {
      throw new Error("Add at least a sender, subject, or forwarding-account pattern before previewing a newsletter source.");
    }

    const existingFeedId = draft.feedId;
    const existingFeed = existingFeedId
      ? await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id, sourceType: "newsletter" })
      : null;

    const messages = await fetchMatchingNewsletterMessages({
      mailbox: draft.mailbox,
      senderPattern: draft.senderPattern,
      subjectPattern: draft.subjectPattern,
      forwardedByPattern: draft.forwardedByPattern,
      limit: 1
    });

    if (!messages.length) {
      throw new Error("No matching newsletter email was found. Try a broader sender or subject pattern.");
    }

    const message = messages[0];
    const candidate = await extractNewsletterItems({
      message,
      guidance: draft.guidance,
      title: draft.title || existingFeed?.title || ""
    });

    req.session.newsletterSourceDraft = {
      ...draft,
      title: draft.title || existingFeed?.title || candidate.feedTitle,
      candidate,
      message: {
        from: message.from,
        subject: message.subject,
        originalFrom: message.originalFrom || "",
        originalSubject: message.originalSubject || "",
        receivedAt: message.receivedAt,
        messageId: message.messageId
      }
    };

    return renderPreferences(req, res, {
      newsletterSourceDraft: req.session.newsletterSourceDraft
    });
  } catch (error) {
    const draft = buildNewsletterSourceDraft(req);
    req.session.newsletterSourceDraft = {
      ...draft,
      candidate: null
    };

    return renderPreferences(req, res, {
      newsletterSourceError: error.message,
      newsletterSourceDraft: req.session.newsletterSourceDraft
    });
  }
});

router.post("/prefs/newsletter-sources/discard", requireAuth, async (req, res) => {
  delete req.session.newsletterSourceDraft;
  return res.redirect("/prefs");
});

router.post("/prefs/newsletter-sources/confirm", requireAuth, async (req, res) => {
  const draft = req.session.newsletterSourceDraft;
  if (!draft?.candidate) {
    return res.redirect("/prefs");
  }

  const existingFeedId = draft.feedId || "";
  const feedPayload = {
    title: draft.title || draft.candidate.feedTitle || draft.subjectPattern || "Newsletter Source",
    feedUrl: existingFeedId ? undefined : `newsletter://${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    siteUrl: "",
    categoryId: draft.categoryIds?.[0] || null,
    categoryIds: draft.categoryIds || [],
    sourceType: "newsletter",
    newsletterConfig: {
      senderPattern: draft.senderPattern || "",
      subjectPattern: draft.subjectPattern || "",
      forwardedByPattern: draft.forwardedByPattern || "",
      mailbox: draft.mailbox || env.imapMailbox || "INBOX",
      guidance: draft.guidance || "",
      notes: draft.candidate.notes || "",
      previewItems: draft.candidate.previewItems || [],
      latestMessageId: draft.message?.messageId || "",
      latestMessageSubject: draft.message?.subject || "",
      latestMessageAt: draft.message?.receivedAt ? new Date(draft.message.receivedAt) : null,
      verificationStatus: "verified",
      lastVerifiedAt: new Date()
    }
  };

  let feed;
  if (existingFeedId) {
    const existingFeed = await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id, sourceType: "newsletter" });
    if (!existingFeed) {
      delete req.session.newsletterSourceDraft;
      return res.redirect("/prefs");
    }

    await Feed.updateOne(
      { _id: existingFeedId, userId: req.currentUser._id },
      {
        $set: {
          title: feedPayload.title,
          siteUrl: feedPayload.siteUrl,
          categoryId: feedPayload.categoryId,
          categoryIds: feedPayload.categoryIds,
          sourceType: "newsletter",
          newsletterConfig: feedPayload.newsletterConfig
        }
      }
    );
    feed = await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id });
  } else {
    feed = await createFeed({
      userId: req.currentUser._id,
      ...feedPayload
    });
  }

  delete req.session.newsletterSourceDraft;
  await refreshFeedById(feed._id, req.currentUser._id);
  return res.redirect(`/?feed=${feed._id}`);
});

router.post("/prefs/bluesky-sources/preview", requireAuth, async (req, res) => {
  try {
    const draft = buildBlueskySourceDraft(req);
    if (!draft.handle) {
      throw new Error("Add a Bluesky handle before previewing a Bluesky source.");
    }

    const existingFeed = draft.feedId
      ? await Feed.findOne({ _id: draft.feedId, userId: req.currentUser._id, sourceType: "bluesky" })
      : null;

    const candidate = await fetchBlueskyAuthorFeed({
      handle: draft.handle,
      includeReplies: draft.includeReplies,
      includeReposts: draft.includeReposts,
      limit: 30
    });

    req.session.blueskySourceDraft = {
      ...draft,
      title: draft.title || existingFeed?.title || candidate.feedTitle,
      candidate
    };

    return renderPreferences(req, res, {
      blueskySourceDraft: req.session.blueskySourceDraft
    });
  } catch (error) {
    const draft = buildBlueskySourceDraft(req);
    req.session.blueskySourceDraft = {
      ...draft,
      candidate: null
    };

    return renderPreferences(req, res, {
      blueskySourceError: error.message,
      blueskySourceDraft: req.session.blueskySourceDraft
    });
  }
});

router.post("/prefs/bluesky-sources/discard", requireAuth, async (req, res) => {
  delete req.session.blueskySourceDraft;
  return res.redirect("/prefs");
});

router.post("/prefs/bluesky-sources/confirm", requireAuth, async (req, res) => {
  const draft = req.session.blueskySourceDraft;
  if (!draft?.candidate) {
    return res.redirect("/prefs");
  }

  const existingFeedId = draft.feedId || "";
  const handle = normalizeHandle(draft.handle);
  const feedPayload = {
    title: draft.title || draft.candidate.feedTitle || `@${handle} on Bluesky`,
    feedUrl: `bluesky://${handle}`,
    siteUrl: draft.candidate.siteUrl || `https://bsky.app/profile/${handle}`,
    categoryId: draft.categoryIds?.[0] || null,
    categoryIds: draft.categoryIds || [],
    sourceType: "bluesky",
    blueskyConfig: {
      handle,
      includeReplies: Boolean(draft.includeReplies),
      includeReposts: Boolean(draft.includeReposts),
      notes: draft.candidate.notes || "",
      previewItems: draft.candidate.previewItems || [],
      latestPostUri: draft.candidate.latestPostUri || "",
      verificationStatus: "verified",
      lastVerifiedAt: new Date()
    }
  };

  let feed;
  if (existingFeedId) {
    await Feed.updateOne(
      { _id: existingFeedId, userId: req.currentUser._id, sourceType: "bluesky" },
      { $set: feedPayload }
    );
    feed = await Feed.findOne({ _id: existingFeedId, userId: req.currentUser._id });
  } else {
    feed = await createFeed({
      userId: req.currentUser._id,
      ...feedPayload
    });
  }

  delete req.session.blueskySourceDraft;
  await refreshFeedById(feed._id, req.currentUser._id);
  return res.redirect(`/?feed=${feed._id}`);
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
