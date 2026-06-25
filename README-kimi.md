# Kimi API 接入

本 demo 通过 `server.mjs` 在本地代理 Kimi API，避免把 API Key 暴露到浏览器源码里。

启动方式：

```bash
KIMI_API_KEY="你的 Kimi API Key" node server.mjs
```

然后打开：

```text
http://127.0.0.1:8765/
```

可选环境变量：

- `PORT`：本地端口，默认 `8765`
- `KIMI_MODEL`：Kimi 模型，默认 `kimi-k2.6`

