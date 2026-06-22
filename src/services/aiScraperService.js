const { load } = require("cheerio");
const env = require("../config/env");

const ruleSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedTitle: { type: "string" },
    siteUrl: { type: "string" },
    notes: { type: "string" },
    rule: {
      type: "object",
      additionalProperties: false,
      properties: {
        itemSelector: { type: "string" },
        titleSelector: { type: "string" },
        linkSelector: { type: "string" },
        dateSelector: { type: "string" },
        summarySelector: { type: "string" },
        contentSelector: { type: "string" },
        titleAttribute: { type: "string" },
        linkAttribute: { type: "string" },
        dateAttribute: { type: "string" },
        maxItems: { type: "number" }
      },
      required: [
        "itemSelector",
        "titleSelector",
        "linkSelector",
        "dateSelector",
        "summarySelector",
        "contentSelector",
        "titleAttribute",
        "linkAttribute",
        "dateAttribute",
        "maxItems"
      ]
    }
  },
  required: ["feedTitle", "siteUrl", "notes", "rule"]
};

function ensureOpenAIConfigured() {
  if (!env.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
}

function getRuleGenerationModels() {
  const models = [env.openaiModel, ...(env.openaiFallbackModels || [])]
    .map((model) => String(model || "").trim())
    .filter(Boolean);

  return [...new Set(models)];
}

async function fetchPageHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "InfoFilterBot/1.0 (+https://infofilter.local)"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch source page: ${response.status} ${response.statusText}`);
  }

  return {
    html: await response.text(),
    finalUrl: response.url || url
  };
}

async function fetchRenderedPageHtml(url, options = {}) {
  let playwright;
  try {
    playwright = require("playwright");
  } catch (_error) {
    throw new Error("Browser mode requires the `playwright` package. Run `npm install` and restart the app.");
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 1200 },
      locale: "en-US"
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: options.waitUntil || "networkidle",
      timeout: 45000
    });
    if (options.waitForSelector) {
      await page.waitForSelector(options.waitForSelector, { timeout: 15000 });
    }
    const delayMs = Math.max(0, Number(options.waitAfterLoadMs || 1500));
    if (delayMs) {
      await page.waitForTimeout(delayMs);
    }
    const html = await page.content();
    const finalUrl = page.url();
    await context.close();
    return { html, finalUrl };
  } finally {
    await browser.close();
  }
}

async function fetchSourceHtml(url, options = {}) {
  const mode = options.fetchMode || "auto";

  if (mode === "direct") {
    return {
      ...(await fetchPageHtml(url)),
      resolvedFetchMode: "direct"
    };
  }

  if (mode === "browser") {
    return {
      ...(await fetchRenderedPageHtml(url, options)),
      resolvedFetchMode: "browser"
    };
  }

  try {
    return {
      ...(await fetchPageHtml(url)),
      resolvedFetchMode: "direct"
    };
  } catch (_error) {
    return {
      ...(await fetchRenderedPageHtml(url, options)),
      resolvedFetchMode: "browser"
    };
  }
}

function cleanHtmlForPrompt(html) {
  const $ = load(html);
  $("script, style, noscript, svg").remove();
  const cleaned = $.html("body") || $.html();
  return cleaned.replace(/\s+/g, " ").slice(0, 120000);
}

function extractText(node) {
  return node.text().replace(/\s+/g, " ").trim();
}

function getTargetNode($item, selector) {
  if (!selector || selector === ":scope" || selector === "self") {
    return $item;
  }

  return $item.find(selector).first();
}

function getFieldValue($item, selector, attribute) {
  const target = getTargetNode($item, selector);
  if (!target || target.length === 0) return "";
  if (attribute) {
    return String(target.attr(attribute) || "").trim();
  }
  return extractText(target);
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  if (!maybeRelativeUrl) return "";
  try {
    return new URL(maybeRelativeUrl, baseUrl).toString();
  } catch (_error) {
    return maybeRelativeUrl;
  }
}

function normalizeRule(rule) {
  return {
    itemSelector: rule.itemSelector || "",
    titleSelector: rule.titleSelector || "",
    linkSelector: rule.linkSelector || "",
    dateSelector: rule.dateSelector || "",
    summarySelector: rule.summarySelector || "",
    contentSelector: rule.contentSelector || "",
    titleAttribute: rule.titleAttribute || "",
    linkAttribute: rule.linkAttribute || "href",
    dateAttribute: rule.dateAttribute || "",
    maxItems: Math.max(1, Math.min(Number(rule.maxItems || 20), 50))
  };
}

function countSelector($, selector, scope = null) {
  if (!selector) return 0;

  try {
    return scope ? scope.find(selector).length : $(selector).length;
  } catch (_error) {
    return -1;
  }
}

function collectLinkSamples($, baseUrl) {
  const seen = new Set();
  const links = [];

  $("a[href]").each((_, element) => {
    if (links.length >= 12) return false;

    const $link = $(element);
    const text = extractText($link).slice(0, 180);
    const href = resolveUrl(baseUrl, String($link.attr("href") || "").trim());

    if (!text || text.length < 12 || !href || seen.has(href)) {
      return undefined;
    }

    seen.add(href);
    links.push({ text, href });
    return undefined;
  });

  return links;
}

function collectContainerSamples($, baseUrl) {
  const selectors = [
    "article",
    "main article",
    "[role='article']",
    ".article",
    ".post",
    ".story",
    ".stream-item",
    ".content-feed__article"
  ];
  const samples = [];
  const seen = new Set();

  selectors.forEach((selector) => {
    if (samples.length >= 8) return;

    try {
      $(selector).slice(0, 4).each((_, element) => {
        if (samples.length >= 8) return false;

        const $element = $(element);
        const text = extractText($element).slice(0, 220);
        const href = resolveUrl(baseUrl, String($element.find("a[href]").first().attr("href") || "").trim());
        const key = `${selector}:${href}:${text.slice(0, 40)}`;

        if (!text || seen.has(key)) {
          return undefined;
        }

        seen.add(key);
        samples.push({
          selector,
          text,
          href
        });
        return undefined;
      });
    } catch (_error) {
      // Ignore invalid selectors in debug sampling.
    }
  });

  return samples;
}

function buildDebugSnapshot({
  requestUrl,
  finalUrl,
  html,
  candidate = null,
  resolvedFetchMode = "unknown",
  fetchMode = "auto",
  waitUntil = "networkidle",
  waitForSelector = "",
  waitAfterLoadMs = 1500
}) {
  const $ = load(html);
  $("script, style, noscript, svg").remove();

  const cleanedBody = ($.html("body") || $.html() || "").replace(/\s+/g, " ").trim();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const normalizedRule = candidate?.rule ? normalizeRule(candidate.rule) : null;
  const itemSelector = normalizedRule?.itemSelector || "";
  const itemMatches = itemSelector ? countSelector($, itemSelector) : 0;
  let firstItemPreview = null;

  if (itemSelector && itemMatches > 0) {
    try {
      const $firstItem = $(itemSelector).first();
      firstItemPreview = {
        text: extractText($firstItem).slice(0, 260),
        titleMatches: countSelector($, normalizedRule.titleSelector, $firstItem),
        linkMatches: countSelector($, normalizedRule.linkSelector, $firstItem),
        dateMatches: countSelector($, normalizedRule.dateSelector, $firstItem),
        summaryMatches: countSelector($, normalizedRule.summarySelector, $firstItem),
        contentMatches: countSelector($, normalizedRule.contentSelector, $firstItem)
      };
    } catch (_error) {
      firstItemPreview = null;
    }
  }

  return {
    requestUrl,
    finalUrl: finalUrl || requestUrl,
    pageTitle: $("title").first().text().trim() || "Untitled page",
    resolvedFetchMode,
    requestedFetchMode: fetchMode,
    waitUntil,
    waitForSelector,
    waitAfterLoadMs: Number(waitAfterLoadMs || 0),
    selectorCounts: {
      article: $("article").length,
      links: $("a[href]").length,
      headings: $("h1, h2, h3").length,
      lists: $("li").length
    },
    candidateRule: normalizedRule,
    candidateMatchCounts: normalizedRule ? {
      itemSelector: itemMatches,
      titleSelector: countSelector($, normalizedRule.titleSelector),
      linkSelector: countSelector($, normalizedRule.linkSelector),
      dateSelector: countSelector($, normalizedRule.dateSelector),
      summarySelector: countSelector($, normalizedRule.summarySelector),
      contentSelector: countSelector($, normalizedRule.contentSelector)
    } : null,
    generationModel: candidate?.generationModel || "",
    generationFallbackUsed: Boolean(candidate?.generationFallbackUsed),
    generationAttemptedModels: candidate?.generationAttemptedModels || [],
    firstItemPreview,
    containerSamples: collectContainerSamples($, finalUrl || requestUrl),
    topLinks: collectLinkSamples($, finalUrl || requestUrl),
    bodyTextSnippet: bodyText.slice(0, 1800),
    htmlSnippet: cleanedBody.slice(0, 4000)
  };
}

function extractItemsWithRule({ url, html, candidate }) {
  const $ = load(html);
  const rule = normalizeRule(candidate.rule || {});
  const items = [];

  $(rule.itemSelector).slice(0, rule.maxItems).each((_, element) => {
    const $item = $(element);
    const title = getFieldValue($item, rule.titleSelector, rule.titleAttribute);
    const link = resolveUrl(url, getFieldValue($item, rule.linkSelector, rule.linkAttribute || "href"));
    const publishedAt = getFieldValue($item, rule.dateSelector, rule.dateAttribute);
    const summary = getFieldValue($item, rule.summarySelector) || getFieldValue($item, rule.contentSelector);

    if (!title || !link) return;

    items.push({
      title,
      link,
      publishedAt,
      summary
    });
  });

  return {
    feedTitle: candidate.feedTitle || $("title").first().text().trim() || url,
    siteUrl: resolveUrl(url, candidate.siteUrl || url),
    notes: candidate.notes || "",
    rule,
    previewItems: items,
    generationModel: candidate.generationModel || "",
    generationFallbackUsed: Boolean(candidate.generationFallbackUsed),
    generationAttemptedModels: candidate.generationAttemptedModels || []
  };
}

async function requestRuleGeneration({ url, html, guidance = "", previousRule = null, repairReason = "", model }) {
  ensureOpenAIConfigured();

  const systemPrompt = [
    "You generate deterministic CSS-selector scraping rules for converting a web page into feed items.",
    "Return selectors that can be executed by a server-side HTML parser.",
    "Prefer stable selectors for the main content list, not nav, ads, comments, or sidebars.",
    "The goal is to reliably extract the latest content items from future fetches of the same source."
  ].join(" ");

  const userPrompt = [
    `Source URL: ${url}`,
    guidance ? `User guidance: ${guidance}` : "User guidance: none",
    previousRule ? `Previous rule JSON: ${JSON.stringify(previousRule)}` : "Previous rule JSON: none",
    repairReason ? `Repair reason: ${repairReason}` : "Repair reason: none",
    "HTML sample:",
    html
  ].join("\n\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openaiApiKey}`
    },
    body: JSON.stringify({
      model: model || env.openaiModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "scraper_rule_candidate",
          strict: true,
          schema: ruleSchema
        }
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`OpenAI rule generation failed: ${response.status} ${errorBody}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || "";
  if (!content) {
    throw new Error("OpenAI did not return a scraper rule candidate.");
  }

  const candidate = JSON.parse(content);
  candidate.generationModel = model || env.openaiModel;
  return candidate;
}

async function generateScraperCandidate({
  url,
  guidance = "",
  previousRule = null,
  repairReason = "",
  fetchMode = "auto",
  waitUntil = "networkidle",
  waitForSelector = "",
  waitAfterLoadMs = 1500
}) {
  let fetchResult = await fetchSourceHtml(url, {
    fetchMode,
    waitUntil,
    waitForSelector,
    waitAfterLoadMs
  });
  const promptHtml = cleanHtmlForPrompt(fetchResult.html);
  const models = getRuleGenerationModels();
  const generationErrors = [];
  let lastCandidate = null;
  let lastExtracted = null;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];

    let candidate;
    try {
      candidate = await requestRuleGeneration({
        url,
        html: promptHtml,
        guidance,
        previousRule,
        repairReason,
        model
      });
    } catch (error) {
      generationErrors.push(`${model}: ${error.message}`);
      continue;
    }

    candidate.generationFallbackUsed = index > 0;
    candidate.generationAttemptedModels = models;
    lastCandidate = candidate;

    let extracted = extractItemsWithRule({ url, html: fetchResult.html, candidate });
    if (!extracted.previewItems.length && fetchMode === "auto" && fetchResult.resolvedFetchMode !== "browser") {
      fetchResult = await fetchSourceHtml(url, {
        fetchMode: "browser",
        waitUntil,
        waitForSelector,
        waitAfterLoadMs
      });
      extracted = extractItemsWithRule({ url, html: fetchResult.html, candidate });
    }

    lastExtracted = extracted;

    if (extracted.previewItems.length) {
      return {
        ...extracted,
        resolvedFetchMode: fetchResult.resolvedFetchMode,
        debug: buildDebugSnapshot({
          requestUrl: url,
          finalUrl: fetchResult.finalUrl,
          html: fetchResult.html,
          candidate,
          resolvedFetchMode: fetchResult.resolvedFetchMode,
          fetchMode,
          waitUntil,
          waitForSelector,
          waitAfterLoadMs
        })
      };
    }
  }

  const attemptedLabel = lastExtracted?.generationAttemptedModels?.length
    ? ` Models tried: ${lastExtracted.generationAttemptedModels.join(", ")}.`
    : "";
  const apiFailuresLabel = generationErrors.length
    ? ` API failures: ${generationErrors.join(" | ")}.`
    : "";
  const error = new Error(`The generated rule did not produce any preview items.${attemptedLabel}${apiFailuresLabel} Review the debug output below, then try browser mode, a wait selector, or more guidance.`);
  error.debug = buildDebugSnapshot({
    requestUrl: url,
    finalUrl: fetchResult.finalUrl,
    html: fetchResult.html,
    candidate: lastCandidate,
    resolvedFetchMode: fetchResult.resolvedFetchMode,
    fetchMode,
    waitUntil,
    waitForSelector,
    waitAfterLoadMs
  });
  error.candidate = {
    ...(lastExtracted || {
      feedTitle: lastCandidate?.feedTitle || url,
      siteUrl: lastCandidate?.siteUrl || url,
      notes: lastCandidate?.notes || "",
      rule: normalizeRule(lastCandidate?.rule || {}),
      previewItems: [],
      generationModel: lastCandidate?.generationModel || "",
      generationFallbackUsed: Boolean(lastCandidate?.generationFallbackUsed),
      generationAttemptedModels: lastCandidate?.generationAttemptedModels || models
    }),
    resolvedFetchMode: fetchResult.resolvedFetchMode
  };
  throw error;
}

module.exports = {
  extractItemsWithRule,
  fetchPageHtml,
  fetchRenderedPageHtml,
  fetchSourceHtml,
  generateScraperCandidate
};
