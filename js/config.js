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
2. 外规条文:每条含【srcID】【法规名称/来源标题】【来源URL】【条文原文】(来自内置权威法规库或联网检索)。

【审查目标:力求全面,对标专业律所级审查】
一份典型的公司治理 / 财务 / 合规类制度,通常同时存在多处问题(冲突 + 遗漏 + 越权 + 标准过宽),请逐条排查、尽量找全,不要只报一两条最明显的;宁可多报交人工复核,也不要漏报。

【审查方法:对每一条纳入的外规,逐项核对内规全文】
- 冲突(conflict):内规规定与外规强制性规定直接矛盾。
- 遗漏(omission):外规强制要求的要素 / 职责 / 程序,内规全文未作规定——【这类往往最多,务必逐项主动排查】。方法:把外规该条拆成若干"应当 / 必须"要点,逐一在内规全文中查找是否落实,缺失即为遗漏。
- 越权(ultra_vires):内规赋予的权限或批准层级超出法定 / 授权范围(如本应股东(大)会批准却写成董事会批准)。
- 标准过宽:内规的数量 / 频次 / 比例标准低于外规强制底线(如外规"每季度至少一次"而内规"每年至少一次"),按 conflict 处理,并在 problem 中点明"标准低于外规底线"。

【定位粒度】internal_clause_no 尽量精确到具体条款(第X条);制度若按"章"编排,请定位到该章内最相关的那一处具体规定,internal_quote 逐字摘录该处原句,不要只按整章笼统判断——一章中可能存在多处独立问题,应分别成条列出。

【六条铁律 —— 违反任意一条即视为审查失败】
1. 零编造法条:你引用的每一句外规原文(reg_quote),必须能在“检索结果”对应网页正文片段中逐字找到。严禁引用、补充、改写片段里没有的法条、条款号或表述。
2. 零编造链接:每条引用的 source_url 必须【原样复制】该 srcID 对应的来源URL,绝不允许自己拼凑、猜测或修改任何网址;source_id 必须是输入中真实存在的 srcID。
3. 内规逐字引用:internal_quote 必须从内规全文中逐字照抄命中原句,不得转述、概括或改写。
4. 不臆断但不漏报:仅在能用“内规原文 vs 所提供的法条原文”直接对照时才下结论;需要清单外法规才能判断的,写入 suggested_searches。注意:“遗漏(omission)”本身是有外规支撑的(外规要求 X、内规缺 X),内规全文已完整提供给你,应主动核查并报告,不得因谨慎而漏报遗漏类问题。
5. 必标置信度:每条结论给 confidence(high/medium/low);confidence 为 medium 或 low 时,need_human_review 必须为 true。
6. 给可落地改法:suggestion 必须给出可直接替换的改写文本,不许写“建议完善”“应予明确”这类空话。

【缺口处理】若判断某内规条款需要检索结果之外的法规才能审查,不要猜法条,而是在 suggested_searches 中给出建议检索关键词,供用户补搜后重审。

【审查覆盖】另需输出 coverage 数组:对内规的主要条款/章节,逐条说明用哪些外规核对过、结论如何(status:compliant 合规 / risk 有风险 / partial 部分覆盖 / not_covered 检索未覆盖),让用户清楚"每一处用什么法规查过、结论如何"。可合并相邻同类条款,覆盖主要条款即可、无需逐字句;checked_against 用外规名称(取自检索结果)。即使没有风险点,也要给出 coverage,体现审查的全面性。

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
  "suggested_searches": [ { "trigger_clause_no": "<内规条款>", "keywords": ["<词>"], "rationale": "<为什么需要补搜>" } ],
  "coverage": [ { "clause": "<内规条款或章节,如 第十八条>", "topic": "<该条主题,如 会议通知期限>", "checked_against": ["<核对依据的外规名称>"], "status": "compliant|risk|partial|not_covered", "note": "<一句话结论>" } ]
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
    lines.push(`正文片段:"${(r.quote || r.content || '').slice(0, 2500)}"`);
    lines.push('');
  });
  lines.push(`# 审查模式:${mode === 'full' ? '全文体检(对内规每一条都要核对,尽量全覆盖)' : '快速(只输出明确风险点)'}`);
  lines.push('请开始审查,严格按 System 中的 JSON 结构输出。');
  return lines.join('\n');
}

// 查漏复审(第二遍):基于已发现问题,专门找"遗漏的"问题
export const CRITIC_PROMPT = `你是合规审查复核专家。下面给你:内规全文、本次纳入的外规条文、以及"已发现的问题"清单。请再做一轮【查漏】:逐条核对内规与外规,找出【尚未发现的、被遗漏的】问题——尤其是"遗漏(omission)"类(外规强制要求某要素 / 职责 / 程序,内规全文未作规定),以及冲突、越权、标准过宽。
方法:把每条外规拆成若干"应当 / 必须"要点,逐一在内规全文中查找是否落实,缺失即为遗漏。
要求:
- 只输出【新增】问题,不要重复"已发现的问题"清单里的条目;若确无新增,findings 返回空数组。
- 同样遵守:零编造法条(reg_quote 须在所提供外规条文中逐字可找到)、零编造链接(source_url 原样复制对应 srcID 的 URL)、内规逐字引用(internal_quote 逐字照抄)、必标置信度。
严格只输出单个 JSON 对象,不要任何其它文字:{"findings":[ { 与主审查相同的 finding 结构:id/round/risk_type/severity/internal_clause_no/internal_quote/source_id/reg_name/reg_clause_no/reg_quote/source_url/problem/suggestion/confidence/need_human_review } ]}`;

export function buildCriticMessage(docText, regs, existing) {
  const ex = (existing || []).map((f, i) =>
    `${i + 1}. ${f.internal_clause_no || ''} ${f.risk_type || ''} — ${(f.problem || '').slice(0, 50)}`
  ).join('\n') || '(无)';
  return buildUserMessage(docText, regs, 'full') +
    '\n\n# 已发现的问题(请勿重复,只找新增的遗漏 / 冲突 / 越权 / 过宽):\n' + ex;
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

// 权威立法/监管来源域名(用于把联网检索限定在官方来源,过滤公司文件/新闻噪音)
export const LAW_DOMAINS = [
  'flk.npc.gov.cn',   // 国家法律法规数据库
  'npc.gov.cn',
  'gov.cn',
  'csrc.gov.cn',      // 证监会
  'nfra.gov.cn',      // 国家金融监督管理总局
  'pbc.gov.cn',       // 人民银行
  'court.gov.cn',     // 最高法
  'samr.gov.cn',      // 市场监管总局
  'mof.gov.cn',       // 财政部
  'mohrss.gov.cn',    // 人社部(劳动法相关)
];

// 让 AI 先读内规、判断它受哪些"具体法律法规"约束,产出联网检索词。
export const TOPIC_PROMPT = `你是中国法律合规检索专家。阅读用户提供的企业内部制度全文,判断它受哪些【现行有效的中国法律、行政法规、部门规章、监管指引】约束,生成用于联网检索这些"外规"的检索词。
要求:
- 输出 4-7 条检索词;每条尽量包含【具体法律/法规/规章名称】+ 关键主题词,例如「中华人民共和国公司法 董事 辞职」「上市公司治理准则 审计委员会」「中华人民共和国合同法 格式条款」。
- 覆盖该制度涉及的不同法域(如公司法、证券法、合同法、民法典、金融监管办法、劳动法、个人信息保护法等),按相关度排序。
- 只针对权威立法/监管文件,不要输出企业自身制度名、其他公司的文件名或新闻标题。
- 严格只输出 JSON,无任何其它文字:{"queries":["...","..."]}`;

export function buildTopicMessage(docText) {
  return '企业内部制度全文:\n<<<\n' + (docText || '').slice(0, 6000) + '\n>>>\n\n请按要求只输出 JSON。';
}

export const RISK_LABELS = {
  conflict: '直接冲突', omission: '遗漏要求', ultra_vires: '越权超范围',
  ambiguous: '表述模糊', wording: '措辞优化', outdated: '过时引用',
};
export const SEVERITY_LABELS = { high: '高', medium: '中', low: '低' };
