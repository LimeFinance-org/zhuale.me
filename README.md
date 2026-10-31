# zhuale.me

“抓了么”是一个紧急情况律师协助服务：**定期打卡报平安，超时未打卡自动上报，由专业刑事律师联系你的紧急联系人。**

怎么用：

1. **注册**：生成专属密钥，无需手机号或邮箱。
2. **登记**：填写紧急联系人和联系方式，资料在浏览器端加密后保存，平台读不到。
3. **打卡**：按自选周期（24 小时 / 48 小时 / 72 小时 / 一周）点一下，表示你是安全的。
4. **上报**：超时未打卡时自动上报（规划中，见下方说明）；也可以由信任的人或快捷指令调用 `https://www.zhuale.me/api/sos` 主动上报。律师会联系你的紧急联系人。

> 注意：超时自动上报的后端（定时检查 + 律师可读的联系人信息）尚未实现，当前版本只能在后台看到账户超时状态。

技术上，项目基于 Cloudflare Workers + D1 运行。

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
