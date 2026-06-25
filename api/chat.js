const { randomUUID } = require("node:crypto");

const sessionCookieName = "cielva_session";
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 12);
const maxMessageLength = Number(process.env.MAX_MESSAGE_LENGTH || 4000);
const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
const model = process.env.KIMI_MODEL || "kimi-k2.6";
const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const rateLimits = new Map();

function isSecureRequest(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return Boolean(req.socket?.encrypted);
}

function buildHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    ...extra
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const headers = buildHeaders(extraHeaders);
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return Object.fromEntries(
    header.split(";").map((part) => {
      const [rawKey, ...rawValue] = part.trim().split("=");
      return [rawKey, decodeURIComponent(rawValue.join("="))];
    })
  );
}

function formatSessionCookie(req, sessionId) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(sessionId)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(sessionTtlMs / 1000)}`
  ];

  if (isSecureRequest(req)) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function ensureSession(req, res) {
  const existingSessionId = parseCookies(req)[sessionCookieName];
  if (existingSessionId) {
    return existingSessionId;
  }

  const sessionId = randomUUID();
  res.setHeader("set-cookie", formatSessionCookie(req, sessionId));
  return sessionId;
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function pruneRateLimits() {
  const cutoff = Date.now() - rateLimitWindowMs;
  for (const [key, record] of rateLimits.entries()) {
    if (record.windowStartedAt < cutoff) {
      rateLimits.delete(key);
    }
  }
}

function consumeRateLimit(req, sessionId) {
  pruneRateLimits();

  const key = `${sessionId}:${getClientIp(req)}`;
  const now = Date.now();
  const current = rateLimits.get(key);

  if (!current || now - current.windowStartedAt >= rateLimitWindowMs) {
    rateLimits.set(key, { count: 1, windowStartedAt: now });
    return { ok: true };
  }

  if (current.count >= rateLimitMax) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((current.windowStartedAt + rateLimitWindowMs - now) / 1000)
    );
    return { ok: false, retryAfterSeconds };
  }

  current.count += 1;
  return { ok: true };
}

function getRequestOrigin(req) {
  const host = req.headers.host;
  if (!host) {
    return null;
  }
  const protocol = isSecureRequest(req) ? "https" : "http";
  return `${protocol}://${host}`;
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  const allowedOrigins = new Set(configuredOrigins);
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) {
    allowedOrigins.add(requestOrigin);
  }

  return allowedOrigins.has(origin);
}

async function readPayload(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed." }, { allow: "POST" });
    return;
  }

  if (!apiKey) {
    sendJson(res, 500, { error: "KIMI_API_KEY is not configured." });
    return;
  }

  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: "Origin is not allowed." });
    return;
  }

  const sessionId = ensureSession(req, res);
  const rateLimit = consumeRateLimit(req, sessionId);
  if (!rateLimit.ok) {
    sendJson(
      res,
      429,
      { error: "Too many requests. Please wait a moment and try again." },
      { "retry-after": String(rateLimit.retryAfterSeconds) }
    );
    return;
  }

  let payload;
  try {
    payload = await readPayload(req);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body." });
    return;
  }

  const message = String(payload.message || "").trim();
  const hasAttachment = Boolean(payload.hasAttachment);
  const agent = payload.agent === "expert" ? "expert" : "home";

  if (!message && !hasAttachment) {
    sendJson(res, 400, { error: "Message is required." });
    return;
  }

  if (message.length > maxMessageLength) {
    sendJson(res, 400, {
      error: `Message is too long. Keep it within ${maxMessageLength} characters.`
    });
    return;
  }

  const systemPrompt = agent === "expert"
    ? "你是社媒运营专家，擅长账号定位、选题规划、社媒文案、内容拆解和数据复盘。请用简洁、可执行的中文回答。"
    : "你是 Cielva Claw，一个中文优先、温和可靠的个人智能体助手。请先理解用户需求，再给出简洁可执行的回答。";
  const userMessage = hasAttachment && !message
    ? "用户上传了一张图片，请以通用方式说明你会如何分析这张图片。"
    : message;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const kimiRes = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 1
      })
    });

    const data = await kimiRes.json().catch(() => ({}));
    if (!kimiRes.ok) {
      console.error("Kimi API request failed:", kimiRes.status, data);
      sendJson(res, kimiRes.status, { error: "Kimi API request failed." });
      return;
    }

    sendJson(res, 200, {
      reply: data?.choices?.[0]?.message?.content || "我暂时没有拿到有效回复，请稍后再试。"
    });
  } catch (error) {
    console.error("Failed to call Kimi API:", error);
    sendJson(res, 502, { error: "Failed to call Kimi API." });
  } finally {
    clearTimeout(timeout);
  }
};
