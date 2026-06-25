# Kimi API 接入

本 demo 通过 `server.mjs` 代理 Kimi API，API Key 只保存在服务端，不会暴露到浏览器源码里。

启动方式：

```bash
cp .env.example .env.local
```

把 `.env.local` 里的 `KIMI_API_KEY` 改成你自己的 key，然后启动：

```bash
node server.mjs
```

然后打开：

```text
http://127.0.0.1:8765/
```

可选环境变量：

- `PORT`：本地端口，默认 `8765`
- `HOST`：监听地址，本地预览用 `127.0.0.1`，公开部署时通常设为 `0.0.0.0`
- `KIMI_MODEL`：Kimi 模型，默认 `kimi-k2.6`
- `ALLOWED_ORIGINS`：公开部署时建议填写你的正式域名，多个域名用逗号分隔
- `RATE_LIMIT_MAX`：每个会话窗口内最多请求数，默认 `12`
- `RATE_LIMIT_WINDOW_MS`：限流窗口毫秒数，默认 `60000`
- `MAX_MESSAGE_LENGTH`：单次消息最大长度，默认 `4000`

部署提醒：

- 不要把 Kimi key 写进 `index.html`、前端 JS 或公开仓库。
- 如果只是静态托管页面，不能安全地直连 Kimi API；需要把 `server.mjs` 一起部署到你自己的服务端环境。
- 当前服务已加上本地私密配置文件、会话 cookie 和基础限流，适合公开网页接入时做第一层保护。
