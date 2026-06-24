# LexScope 搜索转发 Worker · 部署说明

> 作用见 [`worker.js`](worker.js) 顶部注释。一句话:让搜索 API 能从纯静态网页调用(绕过浏览器 CORS),且不把你的 Key 交给任何第三方。
>
> **不需要域名、不花钱**。Cloudflare 免费账号 + 自带的 `*.workers.dev` 子域名即可。

## 方式一:网页控制台(推荐,全程点鼠标)

1. **注册 / 登录** Cloudflare:打开 <https://dash.cloudflare.com>,用邮箱注册免费账号。
2. 左侧菜单 **Workers & Pages → Create**。在「Ship something new」面板里,点 **「从 Hello World! 开始 / Start with Hello World!」**(不要点 Connect GitHub、Upload static files、想要部署 Pages —— 那几个是部署前端网页用的)。
3. 给 Worker 命名,比如 `lexscope-proxy`,其余默认 → 点 **Deploy / 部署**(先把默认模板部署上去)。
4. 部署完成后点 **Edit code / 编辑代码** 进编辑器,把默认代码**全部删除**,粘贴本目录 [`worker.js`](worker.js) 的**全部内容** → 右上角 **Deploy / 部署**。
5. 复制分配给你的网址,形如:
   ```
   https://lexscope-proxy.你的子域.workers.dev
   ```
6. 打开 LexScope → 右上角 **设置 → 转发前缀**,粘贴上面的网址,**末尾务必加一个斜杠**:
   ```
   https://lexscope-proxy.你的子域.workers.dev/
   ```
   保存即可。之后第 2 步「联网检索」就能正常工作了。

## 方式二:命令行(开发者)

```bash
npm i -g wrangler        # 或 npx wrangler ...
wrangler login
wrangler deploy worker.js --name lexscope-proxy
```

## 验证是否部署成功

浏览器直接打开(注意结尾拼了一个真实 API 地址):

```
https://lexscope-proxy.你的子域.workers.dev/https://api.tavily.com/search
```

- 看到类似 `{"error":...}` 或 Tavily 的 JSON 报错(因为没带参数)→ 说明 Worker 通了、CORS 已生效 ✅
- 看到 `目标主机不在白名单内` → 说明你改过白名单,把对应 API 主机加回 `ALLOW_HOSTS`。

## 安全说明

- **无状态**:Worker 不存储、不记录任何请求内容或密钥,转发完即丢。
- **主机白名单**:`worker.js` 里的 `ALLOW_HOSTS` 只允许转发到 Tavily / Serper / Bing / DeepSeek,防止被人当成开放代理滥用。换搜索服务时记得同步增减。
- Key 始终只经过**你自己的** Cloudflare 账号,不经任何陌生第三方——这正是它优于公共 CORS 代理的地方。
