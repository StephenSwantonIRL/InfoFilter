const Label = require("../models/Label");

function matchesRule(rule, article) {
  const source = Array.isArray(article[rule.field])
    ? article[rule.field].join(", ")
    : String(article[rule.field] || "");
  const result = new RegExp(rule.pattern, "i").test(source);
  return rule.inverse ? !result : result;
}

function matchesFilter(filter, article) {
  const ruleResults = (filter.rules || []).map((rule) => matchesRule(rule, article));
  const matched = filter.matchMode === "all" ? ruleResults.every(Boolean) : ruleResults.some(Boolean);
  return filter.inverse ? !matched : matched;
}

async function applyFilters(filters, article) {
  const nextArticle = { ...article, labelIds: [...(article.labelIds || [])], tags: [...(article.tags || [])] };
  let deleted = false;
  let stop = false;

  for (const filter of filters.sort((left, right) => left.order - right.order)) {
    if (stop) break;
    if (filter.enabled === false) continue;
    if (!matchesFilter(filter, nextArticle)) continue;

    for (const action of filter.actions) {
      if (action.type === "delete") deleted = true;
      if (action.type === "markRead") nextArticle.isRead = true;
      if (action.type === "star") nextArticle.isStarred = true;
      if (action.type === "publish") nextArticle.isPublished = true;
      if (action.type === "tag") {
        const tags = action.value.split(",").map((tag) => tag.trim()).filter(Boolean);
        nextArticle.tags.push(...tags);
      }
      if (action.type === "score") nextArticle.score += Number(action.value || 0);
      if (action.type === "label" && action.value) {
        const label = await Label.findOne({ _id: action.value, userId: article.userId });
        if (label) nextArticle.labelIds.push(label._id);
      }
      if (action.type === "ignoreTags") {
        const ignored = action.value.split(",").map((tag) => tag.trim().toLowerCase());
        nextArticle.tags = nextArticle.tags.filter((tag) => !ignored.includes(tag.toLowerCase()));
      }
      if (action.type === "stop") stop = true;
    }
  }

  return { article: nextArticle, deleted };
}

module.exports = {
  applyFilters,
  matchesFilter
};
