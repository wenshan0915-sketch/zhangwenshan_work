import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const envFiles = [".env.local", ".env"];

function loadLocalEnv() {
  for (const envFile of envFiles) {
    const envPath = join(root, envFile);
    if (!existsSync(envPath)) {
      continue;
    }

    const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const equalIndex = trimmed.indexOf("=");
      if (equalIndex <= 0) {
        continue;
      }
      const key = trimmed.slice(0, equalIndex).trim();
      if (!key || process.env[key]) {
        continue;
      }
      let value = trimmed.slice(equalIndex + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

const port = Number(process.env.PORT || 8765);
const host = process.env.HOST || "127.0.0.1";
const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
const model = process.env.KIMI_MODEL || "kimi-k2.6";
const sessionCookieName = "cielva_session";
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 12);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 32 * 1024);
const maxMessageLength = Number(process.env.MAX_MESSAGE_LENGTH || 4000);
const configuredOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const sessions = new Map();
const rateLimits = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp"
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isSecureRequest(req) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return Boolean(req.socket.encrypted);
}

function buildHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...extra
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, buildHeaders({
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  }));
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString("utf8");
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

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function pruneExpiredSessions() {
  const cutoff = Date.now() - sessionTtlMs;
  for (const [sessionId, record] of sessions.entries()) {
    if (record.lastSeenAt < cutoff) {
      sessions.delete(sessionId);
    }
  }
}

function pruneRateLimits() {
  const cutoff = Date.now() - rateLimitWindowMs;
  for (const [key, record] of rateLimits.entries()) {
    if (record.windowStartedAt < cutoff) {
      rateLimits.delete(key);
    }
  }
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

function getSession(req) {
  pruneExpiredSessions();

  const sessionId = parseCookies(req)[sessionCookieName];
  if (!sessionId) {
    return null;
  }

  const record = sessions.get(sessionId);
  if (!record) {
    return null;
  }

  record.lastSeenAt = Date.now();
  return { id: sessionId, record };
}

function ensureSession(req) {
  const existingSession = getSession(req);
  if (existingSession) {
    return existingSession;
  }

  const sessionId = randomUUID();
  const record = {
    createdAt: Date.now(),
    lastSeenAt: Date.now()
  };
  sessions.set(sessionId, record);

  return {
    id: sessionId,
    record,
    cookie: formatSessionCookie(req, sessionId)
  };
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

  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    ...configuredOrigins
  ]);
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) {
    allowedOrigins.add(requestOrigin);
  }

  return allowedOrigins.has(origin);
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

async function handleChat(req, res) {
  if (!apiKey) {
    sendJson(res, 500, { error: "KIMI_API_KEY is not configured." });
    return;
  }

  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: "Origin is not allowed." });
    return;
  }

  const session = getSession(req);
  if (!session) {
    sendJson(res, 403, { error: "Session is required. Reload the page and try again." });
    return;
  }

  const rateLimit = consumeRateLimit(req, session.id);
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
    payload = JSON.parse(await readBody(req));
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
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

  try {
    const kimiRes = await fetch("https://api.moonshot.cn/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(30_000),
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
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = normalize(join(root, pathname));
  const session = ensureSession(req);

  if (!target.startsWith(root) || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, buildHeaders({ "content-type": "text/plain; charset=utf-8" }));
    res.end("Not found");
    return;
  }

  const headers = buildHeaders({
    "content-type": mimeTypes[extname(target)] || "application/octet-stream",
  });
  if (session.cookie) {
    headers["set-cookie"] = session.cookie;
  }

  res.writeHead(200, headers);
  createReadStream(target).pipe(res);
}

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/api/chat")) {
    void handleChat(req, res);
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
  res.end("Method not allowed");
});

server.listen(port, host, () => {
  console.log(`Cielva demo running at http://${host}:${port}/`);
});
