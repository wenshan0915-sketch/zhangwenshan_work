import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const envPath = join(root, ".env");

function loadLocalEnv() {
  if (!existsSync(envPath)) {
    return;
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

loadLocalEnv();

const port = Number(process.env.PORT || 8765);
const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;

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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleChat(req, res) {
  if (!apiKey) {
    sendJson(res, 500, { error: "KIMI_API_KEY is not configured." });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readBody(req));
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
      body: JSON.stringify({
        model: process.env.KIMI_MODEL || "kimi-k2.6",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        temperature: 1
      })
    });

    const data = await kimiRes.json().catch(() => ({}));
    if (!kimiRes.ok) {
      sendJson(res, kimiRes.status, {
        error: data?.error?.message || "Kimi API request failed."
      });
      return;
    }

    sendJson(res, 200, {
      reply: data?.choices?.[0]?.message?.content || "我暂时没有拿到有效回复，请稍后再试。"
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message || "Failed to call Kimi API." });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = normalize(join(root, pathname));

  if (!target.startsWith(root) || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": mimeTypes[extname(target)] || "application/octet-stream",
    "cache-control": "no-store"
  });
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

server.listen(port, "127.0.0.1", () => {
  console.log(`Cielva demo running at http://127.0.0.1:${port}/`);
});
