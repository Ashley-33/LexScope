# LexScope · 审视每一条法规

一款**自带 AI、无后端、不留存**的制度合规审查工具。上传内部制度文件,由你自己的 AI 联网检索权威监管法规,逐条比对找出冲突、遗漏与越权,产出带**法条原文链接**的结论性报告并导出 PDF。

> 与同类工具的根本区别:本平台**不自建法规库**,法条由 AI 联网从权威来源现搜、每条附原文链接供核对——而非依赖一个可能过时的内置库。

## 特性

- **自带 Key**:平台不提供任何 AI token,使用你自己的模型与搜索服务密钥。
- **零存储**:密钥与上传文件仅存于浏览器本地(localStorage / 内存),平台不上传、不留存。导出的报告是唯一留存物。
- **联网检索**:AI 从国家法律法规数据库、金融监管总局、证监会等权威来源检索相关法规。
- **反幻觉**:法条原文与链接均须来自检索结果;`source_url` 未命中检索结果的引用会被标红「链接存疑」。
- **可溯源报告**:双栏审查台(原文高亮 ↔ 风险卡联动)、AI 置信度与人工复核标记、可复算评分、审查指纹。
- **查漏补缺闭环**:AI 提示缺失的法规方向 → 补搜 → 重审。
- **导出 PDF**:浏览器原生打印为 PDF,链接随报告保留。

## 运行

纯静态站点,无需构建。任意静态服务器即可:

```bash
python3 -m http.server 4198
# 打开 http://localhost:4198
```

## 配置(右上角「设置」)

| 项 | 说明 |
|---|---|
| AI 模型接口地址 / 模型 / Key | OpenAI 兼容接口。默认 DeepSeek(`https://api.deepseek.com/v1/chat/completions`)。 |
| 联网搜索服务 / Key | 支持 Tavily / Serper / Bing,自带搜索服务密钥。 |
| 转发前缀(可选) | 用于绕过浏览器 CORS。 |

### 关于 CORS

- **DeepSeek** 的接口返回 CORS 头,浏览器可直连。
- **Tavily / Serper / Bing** 不允许浏览器跨域,需挂一个**无状态转发**(如 Cloudflare Workers / Vercel Edge,只透传 Key、不落库、回写 CORS 头),并把其地址填入「转发前缀」。

## 技术栈

浏览器原生 ES Modules,无打包器、无后端。第三方库(mammoth / pdf.js / tesseract.js)按需从 CDN 动态加载。

- `index.html` / `styles.css` — 界面与打印样式
- `js/config.js` — 审核 Prompt、输出 Schema、设置存取
- `js/parse.js` — 文件解析(Word / PDF / 图片 OCR)
- `js/search.js` — 联网检索(Tavily / Serper / Bing)
- `js/review.js` — 调用模型、反幻觉校验、评分
- `js/report.js` — 报告渲染与 PDF 导出
- `js/app.js` — 集成层

## 隐私

本工具不设服务端存储。所有密钥与文件仅在你的浏览器内处理。AI 生成的结论仅供参考,不构成法律意见,请以法条原文与人工复核为准。
