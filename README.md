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

## 项目结构

```text
cursor-direct-gateway.mjs    Direct Gateway 与管理 API
direct-admin-page.mjs        管理台页面
admin-shared.mjs             管理台共享样式与工具
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
