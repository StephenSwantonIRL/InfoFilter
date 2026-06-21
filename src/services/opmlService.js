const { XMLParser, XMLBuilder } = require("fast-xml-parser");
const FeedCategory = require("../models/FeedCategory");
const { createFeed } = require("./feedService");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function importOpml(xml, userId) {
  const parsed = parser.parse(xml);
  const body = parsed.opml?.body;
  const outlines = normalizeArray(body?.outline);
  let createdCount = 0;

  async function walk(items, parentId = null) {
    for (const item of normalizeArray(items)) {
      if (item.xmlUrl) {
        await createFeed({
          userId,
          title: item.title || item.text || item.xmlUrl,
          feedUrl: item.xmlUrl,
          siteUrl: item.htmlUrl || "",
          categoryId: parentId,
          categoryIds: parentId ? [parentId] : []
        });
        createdCount += 1;
      } else if (item.outline) {
        const category = await FeedCategory.create({
          userId,
          name: item.title || item.text || "Folder",
          parentId
        });
        await walk(item.outline, category._id);
      }
    }
  }

  await walk(outlines);
  return createdCount;
}

function exportOpml(categories, feeds) {
  const byParent = new Map();
  for (const category of categories) {
    const key = String(category.parentId || "root");
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(category);
  }

  function buildCategoryNode(category) {
    const childCategories = byParent.get(String(category._id)) || [];
    const categoryFeeds = feeds.filter((feed) => {
      const ids = feed.categoryIds?.length ? feed.categoryIds : (feed.categoryId ? [feed.categoryId] : []);
      return ids.some((id) => String(id) === String(category._id));
    });
    return {
      text: category.name,
      title: category.name,
      outline: [
        ...childCategories.map(buildCategoryNode),
        ...categoryFeeds.map((feed) => ({
          text: feed.title,
          title: feed.title,
          type: "rss",
          xmlUrl: feed.feedUrl,
          htmlUrl: feed.siteUrl || ""
        }))
      ]
    };
  }

  const rootNode = [
    ...(byParent.get("root") || []).map(buildCategoryNode),
    ...feeds
      .filter((feed) => !(feed.categoryIds?.length) && !feed.categoryId)
      .map((feed) => ({
        text: feed.title,
        title: feed.title,
        type: "rss",
        xmlUrl: feed.feedUrl,
        htmlUrl: feed.siteUrl || ""
      }))
  ];

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: ""
  });

  return builder.build({
    opml: {
      version: "2.0",
      head: { title: "InfoFilter OPML Export" },
      body: { outline: rootNode }
    }
  });
}

module.exports = {
  importOpml,
  exportOpml
};
