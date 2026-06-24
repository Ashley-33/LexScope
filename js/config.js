// config.js — 常量、设置存取、Prompt 模板、Schema 校验
// 设计契约见 README 顶部注释;本文件无外部依赖。

export const LS = {
  modelEndpoint: 'cr_model_endpoint',
  modelName: 'cr_model_name',
  modelKey: 'cr_model_key',
  searchProvider: 'cr_search_provider',
  searchKey: 'cr_search_key',
  proxy: 'cr_proxy', // 可选:为绕过 CORS 的转发前缀(留空则浏览器直连)
};

export const DEFAULTS = {
  modelEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  modelName: 'deepseek-chat',
  searchProvider: 'tavily',
};

// 仅存浏览器本地;平台不上传、不留存。
export function getSettings() {
  return {
    modelEndpoint: localStorage.getItem(LS.modelEndpoint) || DEFAULTS.modelEndpoint,
    modelName: localStorage.getItem(LS.modelName) || DEFAULTS.modelName,
    modelKey: localStorage.getItem(LS.modelKey) || '',
    searchProvider: localStorage.getItem(LS.searchProvider) || DEFAULTS.searchProvider,
    searchKey: localStorage.getItem(LS.searchKey) || '',
    proxy: localStorage.getItem(LS.proxy) || '',
  };
}

export function saveSettings(s) {
  localStorage.setItem(LS.modelEndpoint, s.modelEndpoint || DEFAULTS.modelEndpoint);
  localStorage.setItem(LS.modelName, s.modelName || DEFAULTS.modelName);
  localStorage.setItem(LS.modelKey, s.modelKey || '');
  localStorage.setItem(LS.searchProvider, s.searchProvider || DEFAULTS.searchProvider);
  localStorage.setItem(LS.searchKey, s.searchKey || '');
  localStorage.setItem(LS.proxy, s.proxy || '');
}

// 联网审核 System Prompt —— 法条与链接均须来自“检索结果”,严禁编造。
export const SYSTEM_PROMPT = `你是一名资深金融合规审查专家,将企业内部规章制度(内规)与联网检索到的外部监管法规(外规)逐条比对,找出冲突、遗漏、越权与表述问题。

【输入】
1. 内规全文:用户上传文件解析后的完整文本。
2. 检索结果:搜索引擎抓回的若干网页,每条含【srcID】【来源标题】【来源URL】【网页正文片段(含法条原文)】。

【六条铁律 —— 违反任意一条即视为审查失败】
1. 零编造法条:你引用的每一句外规原文(reg_quote),必须能在“检索结果”对应网页正文片段中逐字找到。严禁引用、补充、改写片段里没有的法条、条款号或表述。
2. 零编造链接:每条引用的 source_url 必须【原样复制】该 srcID 对应的来源URL,绝不允许自己拼凑、猜测或修改任何网址;source_id 必须是输入中真实存在的 srcID。
3. 内规逐字引用:internal_quote 必须从内规全文中逐字照抄命中原句,不得转述、概括或改写。
4. 不臆断:仅在能用“内规原文 vs 网页中的法条原文”直接对照时才下结论。无法在检索结果中找到支撑的,不要报告为风险,而是写入 suggested_searches。
5. 必标置信度:每条结论给 confidence(high/medium/low);confidence 为 medium 或 low 时,need_human_review 必须为 true。
6. 给可落地改法:suggestion 必须给出可直接替换的改写文本,不许写“建议完善”“应予明确”这类空话。

【缺口处理】若判断某内规条款需要检索结果之外的法规才能审查,不要猜法条,而是在 suggested_searches 中给出建议检索关键词,供用户补搜后重审。

【风险类型 risk_type】conflict(冲突)/ omission(遗漏)/ ultra_vires(越权)/ ambiguous(模糊)/ wording(措辞)/ outdated(过时引用)
【严重程度 severity】high / medium / low(wording 固定 low)
【评分】基础分100;每个high扣12,每个medium扣5,每个low扣2;wording不扣分。最低0分。

【输出】严格输出单个 JSON 对象,不要输出 JSON 之外的任何文字、解释或 Markdown 代码块标记。JSON 结构:
{
  "summary": { "score": <int>, "score_breakdown": "<string>", "risk_level": "high|medium|low",
    "counts": { "conflict": <int>, "omission": <int>, "ultra_vires": <int>, "ambiguous": <int>, "wording": <int> } },
  "findings": [ { "id": "F1", "round": 1, "risk_type": "conflict", "severity": "high",
    "internal_clause_no": "<如 第七条,无编号则留空字符串>", "internal_quote": "<逐字照抄内规原句>",
    "source_id": "<如 W1>", "reg_name": "<法规名>", "reg_clause_no": "<条款号>",
    "reg_quote": "<逐字照抄网页中的法条>", "source_url": "<原样复制来源URL>",
    "problem": "<问题说明>", "suggestion": "<可直接替换的改写文本>",
    "confidence": "high|medium|low", "need_human_review": <bool> } ],
  "suggested_searches": [ { "trigger_clause_no": "<内规条款>", "keywords": ["<词>"], "rationale": "<为什么需要补搜>" } ]
}`;

// 组装 user message:内规全文 + 检索结果(只允许引用这些)
export function buildUserMessage(docText, regs, mode) {
  const lines = [];
  lines.push('# 内规全文');
  lines.push('<<<');
  lines.push(docText || '(空)');
  lines.push('>>>');
  lines.push('');
  lines.push(`# 检索结果(共 ${regs.length} 条,你只能引用以下网页内容,source_url 必须原样复制对应 URL)`);
  regs.forEach((r, i) => {
    const id = r.id || ('W' + (i + 1));
    lines.push(`[srcID: ${id}] 标题:${r.title || ''}${r.clauseNo ? ' ' + r.clauseNo : ''}  来源URL:${r.url || ''}`);
    lines.push(`正文片段:"${(r.quote || r.content || '').slice(0, 1200)}"`);
    lines.push('');
  });
  lines.push(`# 审查模式:${mode === 'full' ? '全文体检(对内规每一条都要核对,尽量全覆盖)' : '快速(只输出明确风险点)'}`);
  lines.push('请开始审查,严格按 System 中的 JSON 结构输出。');
  return lines.join('\n');
}

// 从模型返回文本中稳健地提取 JSON 对象
export function extractJSON(text) {
  if (!text) throw new Error('模型返回为空');
  let t = String(text).trim();
  // 去掉 ```json ... ``` 围栏
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // 截取首个 { 到末个 }
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) throw new Error('未在模型返回中找到 JSON');
  return JSON.parse(t.slice(s, e + 1));
}

export const RISK_LABELS = {
  conflict: '直接冲突', omission: '遗漏要求', ultra_vires: '越权超范围',
  ambiguous: '表述模糊', wording: '措辞优化', outdated: '过时引用',
};
export const SEVERITY_LABELS = { high: '高', medium: '中', low: '低' };
