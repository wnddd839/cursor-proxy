# Cursor Proxy

Cursor Proxy 是一个面向自有 Cursor 账号的 OpenAI-compatible 代理网关，目标是把 Cursor 账号池、API 转发、管理台和 NewAPI 接入整理成一个轻量、好部署、好维护的项目。

它适合这些场景：

- 多个 Cursor 账号统一管理
- 给 NewAPI 增加一个 OpenAI 兼容渠道
- 给团队内部提供统一的 `/v1` API 入口
- 在一个管理页面里完成账号导入、启用、禁用、刷新和测试

> 请只在你拥有账号授权、并符合相关服务条款与公司合规要求的场景中使用。
> 不要把 refresh token、管理密码或 API key 提交到仓库。

## 主要能力

- OpenAI-compatible API
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Cursor Direct Gateway
  - 直连 Cursor 上游接口
  - 支持账号池轮询
  - 支持 `auto`、`composer-2-fast` 等模型别名
- 管理台
  - `/direct-admin/`
  - 支持单账号导入、批量导入和 OAuth 登录
  - CodeBuddy 视图支持 OAuth Bearer 登录、API Key 导入、启用、禁用、删除和探针
  - 支持账号启用、禁用、删除、刷新 token 和延迟探针
- 部署
  - 支持 Node.js 直接运行
  - 支持 Docker Compose
  - 支持 Nginx 统一暴露一个公网端口

## 快速开始

本地运行：

```bash
npm install

export CURSOR_DIRECT_API_KEY="replace-with-a-long-random-key"
export CURSOR_DIRECT_ADMIN_PASSWORD="replace-with-a-long-admin-password"
export CURSOR_DIRECT_REQUIRE_API_KEY=true

npm start
```

默认地址：

```text
API:   http://127.0.0.1:32126/v1
Admin: http://127.0.0.1:32126/direct-admin/
```

Docker 运行：

```bash
cp .env.example .env
docker compose up -d --build
```

默认公网入口：

```text
http://<server-ip>:32124/v1
http://<server-ip>:32124/direct-admin/
```

## NewAPI 接入

在 NewAPI 中新增 OpenAI 兼容渠道：

```text
Base URL: http://<server-ip>:32124/v1
API Key: CURSOR_DIRECT_API_KEY
模型: auto / composer-2-fast / composer-2.5-fast
```

然后在管理台导入可用的 Cursor 账号即可。

## CodeBuddy 云端直连（对齐 CodeBuddy2api）

CodeBuddy 路径只走云端 HTTP 直连。本地不需要 `codebuddy --serve`，也不会每次请求 spawn `codebuddy` CLI；`/codebuddy/` 反代只作为可选 Web 登录/查看入口，不是聊天上游。

客户端仍然按 OpenAI 兼容接口接入：

```text
POST http://<server-ip>:32124/v1/chat/completions
Authorization: Bearer <CURSOR_DIRECT_API_KEY>
model: codebuddy/auto 或 codebuddy/<upstream-model>
```

`CURSOR_DIRECT_API_KEY` 是访问本地网关的密码；CodeBuddy 上游凭证需要在 `/direct-admin/#codebuddy` 的 CodeBuddy 面板导入。推荐用 OAuth 网页登录获取 Bearer，也可导入 Profile 访问密钥。账号池会轮询启用账号，并记录失败计数和 `lastError`；禁用账号会被跳过。

CodeBuddy 默认端点按社区 CodeBuddy2api 的云端聊天实现配置：

```text
CURSOR_DIRECT_CODEBUDDY_SITE=global
CURSOR_DIRECT_CODEBUDDY_INTERNET_ENVIRONMENT=public
CURSOR_DIRECT_CODEBUDDY_BASE_URL=https://www.codebuddy.ai
CURSOR_DIRECT_CODEBUDDY_CHAT_COMPLETIONS_PATH=/v2/chat/completions
CURSOR_DIRECT_CODEBUDDY_API_ENDPOINT=
```

`CURSOR_DIRECT_CODEBUDDY_API_ENDPOINT` 是完整聊天端点，设置后优先级最高。未设置时使用 `BASE_URL + CHAT_COMPLETIONS_PATH`。`CODEBUDDY_INTERNET_ENVIRONMENT=internal` 或 `ioa` 会默认使用 `https://copilot.tencent.com`；国内站可用 `site=domestic` / `https://www.codebuddy.cn`，国际站用 `site=global` / `https://www.codebuddy.ai`。Key、站点和 endpoint 必须属于同一环境，否则通常会 401。

`/v1/chat/completions` 的 `codebuddy/*` 请求会保留客户端传入的 `messages`、`tools`、`tool_choice`，只做必要的内容结构规范化；正常 chat 不会注入网关 system prompt 或 contract 文案。`/v1/messages` 上的 `codebuddy/*` 会直接返回 400，提示改用 `/v1/chat/completions`。管理台探针使用独立 marker prompt，不影响普通聊天。

**推荐：OAuth 登录（云端聊天）** — 在 `/direct-admin/#codebuddy` 点击「开始 OAuth 登录」→ 在 CodeBuddy 官网完成授权 →「检查登录 / 导入」。账号类型为 `OAuth Bearer`，用于 `/v2/chat/completions`。

**可选：API Key 导入** — 控制台「访问密钥」生成的 `ck_...` 主要供 CLI / Agent SDK；若探针报 `11140 request illegal`，请改用 OAuth。

若上游返回 `11140`，通常是 Profile API Key 不能直连 HTTP 聊天，不是网关配置错误。

参考：

- [Sliverkiss/CodeBuddy2api](https://github.com/Sliverkiss/CodeBuddy2api)
- [xueyue33/codebuddy2api](https://github.com/xueyue33/codebuddy2api)
- [nopperabbo/codebuddy2api](https://github.com/nopperabbo/codebuddy2api)
- [CodeBuddy CLI HTTP API 文档（CN）](https://www.codebuddy.cn/docs/cli/http-api)
- [CodeBuddy CLI HTTP API 文档（AI）](https://www.codebuddy.ai/docs/zh/cli/http-api)

## 项目结构

```text
cursor-direct-gateway.mjs    Direct Gateway 与管理 API
direct-admin-page.mjs        管理台页面
admin-shared.mjs             管理台共享样式与工具
provider-events.mjs          Provider 事件到 OpenAI/Claude 响应的转换
codebuddy-provider.mjs       CodeBuddy 云端 HTTP Provider 适配
codebuddy-account-pool.mjs   CodeBuddy OAuth Bearer / API Key 账号池
cursor-gateway.mjs           cursor-agent CLI 兼容网关
deploy/                      systemd / Nginx 部署文件
compose.yaml                 Docker Compose 部署
```

## 致谢

这个项目是在多个开源项目和社区实践上继续打磨出来的，感谢这些项目提供的思路和参考：

- [Nomadcxx/opencode-cursor](https://github.com/Nomadcxx/opencode-cursor)
  早期 Cursor 集成和 CLI 代理思路的重要参考。
- [router-for-me/CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
  参考了中转站部署、CLI 代理和管理体验。
- [Quorinex/Kiro-Go](https://github.com/Quorinex/Kiro-Go)
  参考了账号池、网关化部署和管理台交互方式。
- NewAPI 社区生态
  本项目的 `/v1` 兼容接口主要面向 NewAPI 渠道接入。

## License

本仓库按根目录 `LICENSE` 中的 BSD-3-Clause 许可发布。使用和再分发时请同时尊重相关上游项目的许可证。
