const { load } = require("cheerio");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const env = require("../config/env");

const newsletterSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    feedTitle: { type: "string" },
    notes: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          link: { type: "string" },
          publishedAt: { type: "string" },
          summary: { type: "string" }
        },
        required: ["title", "link", "publishedAt", "summary"]
      }
    }
  },
  required: ["feedTitle", "notes", "items"]
};

function ensureImapConfigured() {
  if (!env.imapHost || !env.imapUser || !env.imapPassword) {
    throw new Error("IMAP mailbox is not configured. Add IMAP_HOST, IMAP_USER, and IMAP_PASSWORD to .env.");
  }
}

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

function normalizePattern(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPatternMatcher(pattern) {
  const normalized = normalizePattern(pattern);
  if (!normalized) return () => true;

  try {
    return new RegExp(pattern, "i").test.bind(new RegExp(pattern, "i"));
  } catch (_error) {
    const fallback = new RegExp(escapeRegex(normalized), "i");
    return fallback.test.bind(fallback);
  }
}

function formatAddressList(addresses = []) {
  return addresses
    .map((entry) => entry.address || entry.name || "")
    .filter(Boolean)
    .join(", ");
}

function extractOriginalForwardedMetadata(text = "") {
  const normalizedText = String(text || "").replace(/\r/g, "");
  const fromPatterns = [
    /^from:\s*(.+)$/im,
    /^orig(?:inal)?[- ]from:\s*(.+)$/im
  ];
  const subjectPatterns = [
    /^subject:\s*(.+)$/im,
    /^orig(?:inal)?[- ]subject:\s*(.+)$/im
  ];

  let originalFrom = "";
  let originalSubject = "";

  fromPatterns.some((pattern) => {
    const match = normalizedText.match(pattern);
    if (!match?.[1]) return false;
    originalFrom = match[1].trim();
    return true;
  });

  subjectPatterns.some((pattern) => {
    const match = normalizedText.match(pattern);
    if (!match?.[1]) return false;
    originalSubject = match[1].trim();
    return true;
  });

  return { originalFrom, originalSubject };
}

function cleanEmailHtml(html, text) {
  if (html) {
    const $ = load(html);
    $("script, style, noscript, svg").remove();
    return ($.html("body") || $.html() || "").replace(/\s+/g, " ").trim().slice(0, 120000);
  }

  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 20000);
}

async function withImapClient(fn) {
  ensureImapConfigured();

  const client = new ImapFlow({
    host: env.imapHost,
    port: env.imapPort,
    secure: env.imapSecure,
    tls: {
      rejectUnauthorized: env.imapRejectUnauthorized
    },
    auth: {
      user: env.imapUser,
      pass: env.imapPassword
    }
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function fetchMatchingNewsletterMessages({
  mailbox = env.imapMailbox || "INBOX",
  senderPattern = "",
  subjectPattern = "",
  forwardedByPattern = "",
  limit = 3
}) {
  const senderMatches = buildPatternMatcher(senderPattern);
  const subjectMatches = buildPatternMatcher(subjectPattern);
  const forwardedByMatches = buildPatternMatcher(forwardedByPattern);

  return withImapClient(async (client) => {
    const mailboxInfo = await client.mailboxOpen(mailbox || "INBOX");
    const messageCount = mailboxInfo.exists || 0;
    if (!messageCount) return [];

    const lookback = Math.max(1, Number(env.newsletterMessageLookback || 50));
    const start = Math.max(1, messageCount - lookback + 1);
    const matched = [];

    for await (const message of client.fetch(`${start}:${messageCount}`, {
      uid: true,
      envelope: true,
      source: true,
      internalDate: true
    })) {
      const fromText = formatAddressList(message.envelope?.from || []);
      const subjectText = message.envelope?.subject || "";
      const parsed = await simpleParser(message.source);
      const parsedHtmlText = typeof parsed.html === "string" ? load(parsed.html).text() : "";
      const parsedTextAsHtmlText = parsed.textAsHtml ? load(parsed.textAsHtml).text() : "";
      const originalMetadata = extractOriginalForwardedMetadata([
        parsed.text || "",
        parsedHtmlText,
        parsedTextAsHtmlText
      ].join("\n"));
      const directSenderText = parsed.from?.text || fromText;
      const directSubjectText = parsed.subject || subjectText;
      const candidateSenderText = [directSenderText, originalMetadata.originalFrom].filter(Boolean).join("\n");
      const candidateSubjectText = [directSubjectText, originalMetadata.originalSubject].filter(Boolean).join("\n");

      if (!forwardedByMatches(directSenderText) || !senderMatches(candidateSenderText) || !subjectMatches(candidateSubjectText)) {
        continue;
      }

      matched.push({
        uid: String(message.uid || ""),
        messageId: parsed.messageId || String(message.uid || ""),
        mailbox,
        from: directSenderText,
        subject: directSubjectText,
        originalFrom: originalMetadata.originalFrom,
        originalSubject: originalMetadata.originalSubject,
        receivedAt: parsed.date || message.internalDate || new Date(),
        html: typeof parsed.html === "string" ? parsed.html : "",
        text: parsed.text || "",
        textAsHtml: parsed.textAsHtml || ""
      });
    }

    return matched
      .sort((left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime())
      .slice(0, Math.max(1, limit));
  });
}

async function extractNewsletterItems({
  message,
  guidance = "",
  title = ""
}) {
  ensureOpenAIConfigured();

  const content = cleanEmailHtml(message.html || message.textAsHtml, message.text);
  const systemPrompt = [
    "You convert a newsletter email into a feed-style list of article items.",
    "Extract only real editorial stories the reader would want in a news feed.",
    "Ignore ads, sponsored blocks, signup links, navigation, podcast promos, and social prompts.",
    "Prefer canonical article links when visible in the email.",
    "Return concise summaries and preserve the order of the newsletter."
  ].join(" ");

  const userPrompt = [
    title ? `Requested feed title: ${title}` : "Requested feed title: none",
    `Mailbox: ${message.mailbox || env.imapMailbox || "INBOX"}`,
    `From: ${message.from || ""}`,
    `Subject: ${message.subject || ""}`,
    message.originalFrom ? `Original forwarded from: ${message.originalFrom}` : "Original forwarded from: none",
    message.originalSubject ? `Original forwarded subject: ${message.originalSubject}` : "Original forwarded subject: none",
    `Received at: ${message.receivedAt ? new Date(message.receivedAt).toISOString() : ""}`,
    guidance ? `User guidance: ${guidance}` : "User guidance: none",
    "Email content:",
    content
  ].join("\n\n");

  const models = getRuleGenerationModels();
  const errors = [];

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openaiApiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "newsletter_candidate",
            strict: true,
            schema: newsletterSchema
          }
        }
      })
    });

    if (!response.ok) {
      errors.push(`${model}: ${response.status} ${await response.text()}`);
      continue;
    }

    const payload = await response.json();
    const contentText = payload.choices?.[0]?.message?.content || "";
    if (!contentText) {
      errors.push(`${model}: OpenAI did not return any extracted items.`);
      continue;
    }

    const candidate = JSON.parse(contentText);
    const previewItems = (candidate.items || [])
      .filter((item) => item.title && item.link)
      .slice(0, 25)
      .map((item) => ({
        title: item.title,
        link: item.link,
        publishedAt: item.publishedAt || "",
        summary: item.summary || ""
      }));

    if (previewItems.length) {
      return {
        feedTitle: title || candidate.feedTitle || message.subject || "Newsletter Feed",
        notes: candidate.notes || "",
        previewItems,
        generationModel: model,
        generationFallbackUsed: index > 0,
        generationAttemptedModels: models
      };
    }

    errors.push(`${model}: returned zero usable items.`);
  }

  throw new Error(`Newsletter extraction failed. ${errors.join(" | ")}`);
}

module.exports = {
  ensureImapConfigured,
  fetchMatchingNewsletterMessages,
  extractNewsletterItems
};
