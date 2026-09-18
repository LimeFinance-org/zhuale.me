# zhuale.me

“抓了么”是一个基于 Cloudflare Workers + D1 的安全打卡与触发上报项目。

当前公开版本唯一支持的运行方式是 Cloudflare Workers + D1；旧版 Go/Docker 服务端入口已从仓库移除，避免不同实现造成隐私边界歧义。

- 官网：[zhuale.me](https://zhuale.me)
- 官方触发 API：`https://www.zhuale.me/api/sos`
- 源码仓库：[LimeFinance-org/zhuale.me](https://github.com/LimeFinance-org/zhuale.me)
- 许可证：[MIT](./LICENSE)

## 数据边界

项目公开的是前端、Worker API、D1 迁移和部署配置，不包含管理员密钥或用户数据。

- 触发前：姓名、联系人、联系方式和备注在浏览器端使用密钥加密；解密密钥不会发送给 Worker。D1 只保存密文、账户哈希、打卡周期和必要时间元数据。
- 官方触发：使用官网或官方 endpoint 触发后，可读上报字段会提交到 `zhuale.me` 的 Worker，由官方 D1 接收并进入后续协助流程。
- 自行部署：用户可以下载源码，将 Worker、D1 和 endpoint 改成自己的部署；自行部署后的数据由自己的 Worker 接收。

## 自行部署

详细的 Cloudflare Workers、D1、Secrets 和域名配置说明见 [README-CLOUDFLARE.md](./README-CLOUDFLARE.md)。

```powershell
npm install
npx wrangler d1 migrations apply zhuale-me-db --remote
npx wrangler deploy
```

请不要把 `.dev.vars`、管理员密码、Session Secret 或 D1 数据提交到仓库。
