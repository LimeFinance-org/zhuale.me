# zhuale.me → Cloudflare Workers

当前版本只使用 Cloudflare Workers + D1：

- `worker/src/index.ts`：Worker API，使用 D1 Prepared Statements。
- `worker/public/index.html`：静态前端副本。
- `worker/public/admin.html`：Worker 版后台页，登录后通过受保护 API 加载用户数据。
- `migrations/0001_initial.sql`：D1 表结构。
- `migrations/0002_client_side_encryption.sql`：清理旧表并建立端侧加密数据边界。
- `wrangler.jsonc`：Worker 名称、Assets、D1 和两个自定义域名配置。

Cloudflare 内部 Worker 标识使用 `zhuale-me`（Worker 标识不允许点号）；对外项目名和两个生产域名仍然是 `zhuale.me` / `www.zhuale.me`。

## 首次部署

在 PowerShell 中进入项目目录：

```powershell
npm install
npx wrangler login
npx wrangler whoami
npx wrangler d1 create zhuale-me-db
```

把 `d1 create` 输出的 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases` 项，然后配置后台密钥：

```powershell
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

部署表结构并发布 Worker：

```powershell
npx wrangler d1 migrations apply zhuale-me-db --remote
npx wrangler deploy
```

`zhuale.me` 和 `www.zhuale.me` 已配置为 Custom Domains。前提是这两个域名已经作为 Cloudflare Zone 加入当前账号；Custom Domain 会由 Cloudflare 创建 DNS 记录和证书。

源码仓库：<https://github.com/LimeFinance-org/zhuale.me>

## 开源与数据流

本项目公开的是网站前端、Worker API 和部署配置，方便用户审阅、下载和自行部署。官网顶部和底部的 GitHub 链接指向上述仓库。

- 触发前：浏览器端使用密钥加密姓名、联系人、联系方式和备注；密钥不会发送给 Worker。D1 只保存密文、账户哈希、打卡周期和时间。
- 官方触发接口：`https://www.zhuale.me/api/sos`。用户主动触发后，提交到这个官方地址的数据会由本项目的 Worker 接收并写入 D1，供后续协助流程使用。
- 自行部署：下载源码后可以改写 `wrangler.jsonc`、D1 和 API endpoint；这时数据会进入用户自己部署的 Worker，而不是官方地址。
- 公开源码不等于公开用户数据；仓库不包含 `.dev.vars`、管理员密钥或 D1 中的数据。

旧的 Go/Docker 入口、本地 `users.db` 和迁移临时文件已从公开部署路径移除；后续用户数据只写入 Cloudflare D1。

## 本地运行

```powershell
Copy-Item .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地测试值
npx wrangler d1 migrations apply zhuale-me-db --local
npx wrangler dev
```

本地打开 Wrangler 输出的地址，后台地址是 `/baby`。

## 重要安全说明

原项目把后台账号密码和固定 Cookie 写在 Go 源码中；Workers 版本改为 Cloudflare Secrets，并使用 HMAC 签名、8 小时有效期、HttpOnly/Secure/SameSite Cookie。当前 Workers 版本已改为端侧加密：注册和登录请求不会发送解密密钥，Worker 不负责解密预触发数据。`/api/sos` 是明确的触发入口，只有触发请求才会接收可读上报字段。
