const PUBLIC_API_HOST = "https://public.api.bsky.app";

function normalizeHandle(handle = "") {
  return String(handle || "").trim().replace(/^@+/, "").toLowerCase();
}

function parsePostRkey(uri = "") {
  const match = String(uri || "").match(/app\.bsky\.feed\.post\/([^/]+)$/);
  return match?.[1] || "";
}

function buildPostUrl(authorHandle, uri) {
  const handle = normalizeHandle(authorHandle);
  const rkey = parsePostRkey(uri);
  if (!handle || !rkey) return "";
  return `https://bsky.app/profile/${handle}/post/${rkey}`;
}

function summarizeText(text = "") {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 280);
}

function titleFromText(text = "", handle = "") {
  const normalized = summarizeText(text);
  if (!normalized) {
    return handle ? `Post by @${normalizeHandle(handle)}` : "Bluesky Post";
  }

  return normalized.length > 90 ? `${normalized.slice(0, 87)}...` : normalized;
}

function isReplyItem(item) {
  return Boolean(item?.reply || item?.post?.record?.reply);
}

function isRepostItem(item) {
  return Boolean(item?.reason && String(item.reason.$type || "").includes("reasonRepost"));
}

function mapFeedItemsToPreviewItems(handle, items = [], options = {}) {
  return items
    .filter((item) => {
      if (!options.includeReplies && isReplyItem(item)) return false;
      if (!options.includeReposts && isRepostItem(item)) return false;
      return Boolean(item?.post?.uri && item?.post?.record);
    })
    .slice(0, 25)
    .map((item) => {
      const post = item.post || {};
      const authorHandle = post.author?.handle || handle;
      const text = post.record?.text || "";
      const summary = summarizeText(text);

      return {
        guid: post.uri || "",
        title: titleFromText(text, authorHandle),
        link: buildPostUrl(authorHandle, post.uri),
        publishedAt: post.record?.createdAt || post.indexedAt || "",
        summary: summary || titleFromText(text, authorHandle),
        author: post.author?.displayName || authorHandle || "",
        uri: post.uri || ""
      };
    })
    .filter((item) => item.link);
}

async function fetchBlueskyAuthorFeed({
  handle,
  includeReplies = false,
  includeReposts = false,
  limit = 30
}) {
  const normalizedHandle = normalizeHandle(handle);
  if (!normalizedHandle) {
    throw new Error("A Bluesky handle is required.");
  }

  const url = new URL("/xrpc/app.bsky.feed.getAuthorFeed", PUBLIC_API_HOST);
  url.searchParams.set("actor", normalizedHandle);
  url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 100))));

  const response = await fetch(url, {
    headers: {
      "User-Agent": "InfoFilterBot/1.0 (+https://infofilter.local)"
    }
  });

  if (!response.ok) {
    throw new Error(`Bluesky feed fetch failed: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const feedItems = Array.isArray(payload.feed) ? payload.feed : [];
  const previewItems = mapFeedItemsToPreviewItems(normalizedHandle, feedItems, {
    includeReplies,
    includeReposts
  });

  if (!previewItems.length) {
    throw new Error("No Bluesky posts matched this source configuration.");
  }

  const firstPost = feedItems.find((item) => item?.post?.author) || {};
  const author = firstPost.post?.author || {};
  const feedTitle = author.displayName
    ? `${author.displayName} on Bluesky`
    : `@${normalizedHandle} on Bluesky`;

  return {
    feedTitle,
    siteUrl: `https://bsky.app/profile/${normalizedHandle}`,
    notes: "Fetched from the public Bluesky AppView.",
    previewItems,
    latestPostUri: previewItems[0]?.uri || "",
    authorHandle: author.handle || normalizedHandle
  };
}

module.exports = {
  fetchBlueskyAuthorFeed,
  normalizeHandle
};
