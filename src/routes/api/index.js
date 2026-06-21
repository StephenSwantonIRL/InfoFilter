const express = require("express");
const User = require("../../models/User");
const Feed = require("../../models/Feed");
const FeedCategory = require("../../models/FeedCategory");
const Article = require("../../models/Article");
const Label = require("../../models/Label");
const { createFeed, refreshFeedById } = require("../../services/feedService");

const router = express.Router();
const sessions = new Map();

function requireSid(req, res, next) {
  const sid = req.body.sid;
  const sessionUser = sessions.get(sid);
  if (!sessionUser) {
    return res.json({ status: 1, content: { error: "NOT_LOGGED_IN" } });
  }
  req.apiUser = sessionUser;
  return next();
}

router.post("/", async (req, res) => {
  const op = req.body.op;

  if (op === "login") {
    const user = await User.findOne({ email: req.body.user?.toLowerCase() });
    if (!user || !(await user.verifyPassword(req.body.password))) {
      return res.json({ status: 1, content: { error: "LOGIN_ERROR" } });
    }
    const sid = `${user._id}-${Date.now()}`;
    sessions.set(sid, { _id: String(user._id), email: user.email });
    return res.json({ status: 0, content: { session_id: sid, api_level: 5 } });
  }

  if (op === "getVersion") {
    return res.json({ status: 0, content: { version: "1.0.0-node", api_level: 5 } });
  }

  return requireSid(req, res, async () => {
    if (op === "getFeeds") {
      const feeds = await Feed.find({ userId: req.apiUser._id }).lean();
      return res.json({
        status: 0,
        content: feeds.map((feed) => ({ id: feed._id, title: feed.title, feed_url: feed.feedUrl }))
      });
    }

    if (op === "getFeedTree") {
      const [categories, feeds] = await Promise.all([
        FeedCategory.find({ userId: req.apiUser._id }).lean(),
        Feed.find({ userId: req.apiUser._id }).lean()
      ]);
      return res.json({ status: 0, content: { categories, feeds } });
    }

    if (op === "getHeadlines") {
      const query = { userId: req.apiUser._id };
      if (req.body.feed_id) query.feedId = req.body.feed_id;
      const articles = await Article.find(query).sort({ publishedAt: -1 }).limit(Number(req.body.limit || 30)).lean();
      return res.json({ status: 0, content: articles });
    }

    if (op === "updateArticle") {
      await Article.updateMany(
        { _id: { $in: req.body.article_ids || [] }, userId: req.apiUser._id },
        { $set: { [req.body.mode]: Boolean(req.body.data) } }
      );
      return res.json({ status: 0, content: { updated: true } });
    }

    if (op === "getLabels") {
      const labels = await Label.find({ userId: req.apiUser._id }).lean();
      return res.json({ status: 0, content: labels });
    }

    if (op === "setArticleLabel") {
      const { article_ids: articleIds = [], label_id: labelId } = req.body;
      await Article.updateMany(
        { _id: { $in: articleIds }, userId: req.apiUser._id },
        { $addToSet: { labelIds: labelId } }
      );
      return res.json({ status: 0, content: { updated: true } });
    }

    if (op === "subscribeToFeed") {
      const feed = await createFeed({
        userId: req.apiUser._id,
        title: req.body.category || req.body.feed_url,
        feedUrl: req.body.feed_url
      });
      return res.json({ status: 0, content: { id: feed._id } });
    }

    if (op === "unsubscribeFeed") {
      await Feed.deleteOne({ _id: req.body.feed_id, userId: req.apiUser._id });
      await Article.deleteMany({ feedId: req.body.feed_id, userId: req.apiUser._id });
      return res.json({ status: 0, content: { removed: true } });
    }

    if (op === "getCounters") {
      const [unread, starred, feeds] = await Promise.all([
        Article.countDocuments({ userId: req.apiUser._id, isRead: false }),
        Article.countDocuments({ userId: req.apiUser._id, isStarred: true }),
        Feed.find({ userId: req.apiUser._id }).lean()
      ]);
      return res.json({
        status: 0,
        content: {
          global: { unread, starred },
          feeds
        }
      });
    }

    if (op === "catchupFeed") {
      await Article.updateMany({ feedId: req.body.feed_id, userId: req.apiUser._id }, { $set: { isRead: true } });
      return res.json({ status: 0, content: { updated: true } });
    }

    if (op === "refreshFeed") {
      await refreshFeedById(req.body.feed_id, req.apiUser._id);
      return res.json({ status: 0, content: { refreshed: true } });
    }

    return res.json({ status: 1, content: { error: "UNKNOWN_OPERATION" } });
  });
});

module.exports = router;
