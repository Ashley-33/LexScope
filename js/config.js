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
    searchProvider: 'tavily', // 已写死为 Tavily(设置里不再让用户选)
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
export const SYSTEM_PROMPT = `你是一名资深金融合规审查专家,将企业内部规章制度(受审文本)与联网检索到的外部监管法规(外规)逐条比对,找出冲突、遗漏、越权与表述问题。

【输入】
1. 受审文本全文:用户上传文件解析后的完整文本。
2. 外规条文:每条含【srcID】【法规名称/来源标题】【来源URL】【条文原文】(来自内置权威法规库或联网检索)。

【审查目标:力求全面,对标专业律所级审查】
一份典型的公司治理 / 财务 / 合规类制度,通常同时存在多处问题(冲突 + 遗漏 + 越权 + 标准过宽),请逐条排查、尽量找全,不要只报一两条最明显的;宁可多报交人工复核,也不要漏报。

【审查方法:对每一条纳入的外规,逐项核对受审文本全文】
- 冲突(conflict):受审文本规定与外规强制性规定直接矛盾。
- 遗漏(omission):外规强制要求的要素 / 职责 / 程序,受审文本全文未作规定——【这类往往最多,务必逐项主动排查】。方法:把外规该条拆成若干"应当 / 必须"要点,逐一在受审文本全文中查找是否落实,缺失即为遗漏。
- 越权(ultra_vires):受审文本赋予的权限或批准层级超出法定 / 授权范围(如本应股东(大)会批准却写成董事会批准)。
- 标准过宽:受审文本的数量 / 频次 / 比例标准低于外规强制底线(如外规"每季度至少一次"而受审文本"每年至少一次"),按 conflict 处理,并在 problem 中点明"标准低于外规底线"。

【定位粒度】internal_clause_no 尽量精确到具体条款(第X条);制度若按"章"编排,请定位到该章内最相关的那一处具体规定,internal_quote 逐字摘录该处原句,不要只按整章笼统判断——一章中可能存在多处独立问题,应分别成条列出。

【用词】problem、suggestion、coverage 等所有结论文字中,一律称这份受审文件为"受审文本",禁止使用"内规"二字。

【六条铁律 —— 违反任意一条即视为审查失败】
1. 零编造法条:你引用的每一句外规原文(reg_quote),必须能在“检索结果”对应网页正文片段中逐字找到。严禁引用、补充、改写片段里没有的法条、条款号或表述。
2. 零编造链接:每条引用的 source_url 必须【原样复制】该 srcID 对应的来源URL,绝不允许自己拼凑、猜测或修改任何网址;source_id 必须是输入中真实存在的 srcID。
3. 受审文本逐字引用:internal_quote 必须从受审文本全文中逐字照抄命中原句,不得转述、概括或改写。
4. 不臆断但不漏报:能用“受审文本原文 vs 所提供的法条原文”直接对照的,正常下结论;吃不准的(某外规是否强制适用存疑、或多部法规规定相互冲突),不要回避、也不要单列检索建议,而是【照常出成 finding】并把 confidence 标 low、need_human_review 置 true,在 problem 里写清不确定点与需人工核实之处。唯一例外:连一条相关外规都指不出的纯空泛猜测,不报。注意:“遗漏(omission)”本身是有外规支撑的(外规要求 X、受审文本缺 X),受审文本全文已完整提供给你,应主动核查并报告,不得因谨慎而漏报遗漏类问题。
5. 必标置信度:每条结论给 confidence,取值只能是 high / medium / low 三者之一(不得用数字或百分比);confidence 为 medium 或 low 时,need_human_review 必须为 true。
6. 给可落地改法:suggestion 必须给出可直接替换的改写文本,不许写“建议完善”“应予明确”这类空话。

【疑点处理】发现疑点但现有法条无法完全确认(例如:不确定某外规是否强制适用于本机构、或多部法规对同一事项规定不一致):不要猜法条、也不要单列检索建议,而是【照常出成一条 finding】——指向具体的受审文本条款 + 你掌握的最相关外规,risk_type 据实(冲突类用 conflict、缺项类用 omission、适用性不清用 ambiguous),confidence=low、need_human_review=true,在 problem 中说清"哪里不确定、需人工核实什么"。若连相关外规都指不出,则不报此条。

【审查覆盖】另需输出 coverage 数组:对受审文本的主要条款/章节,逐条说明用哪些外规核对过、结论如何(status:compliant 合规 / risk 有风险 / partial 部分覆盖 / not_covered 检索未覆盖),让用户清楚"每一处用什么法规查过、结论如何"。可合并相邻同类条款,覆盖主要条款即可、无需逐字句;checked_against 用外规名称(取自检索结果)。即使没有风险点,也要给出 coverage,体现审查的全面性。

【风险类型 risk_type】conflict(冲突)/ omission(遗漏)/ ultra_vires(越权)/ ambiguous(模糊)/ wording(措辞)/ outdated(过时引用)
【严重程度 severity】high / medium / low(wording 固定 low)
【评分】基础分100;每个high扣12,每个medium扣5,每个low扣2;wording不扣分。最低0分。

【输出】严格输出单个 JSON 对象,不要输出 JSON 之外的任何文字、解释或 Markdown 代码块标记。JSON 结构:
{
  "summary": { "score": <int>, "score_breakdown": "<string>", "risk_level": "high|medium|low",
    "counts": { "conflict": <int>, "omission": <int>, "ultra_vires": <int>, "ambiguous": <int>, "wording": <int> } },
  "findings": [ { "id": "F1", "round": 1, "risk_type": "conflict", "severity": "high",
    "internal_clause_no": "<如 第七条,无编号则留空字符串>", "internal_quote": "<逐字照抄受审文本原句>",
    "source_id": "<如 W1>", "reg_name": "<法规名>", "reg_clause_no": "<条款号>",
    "reg_quote": "<逐字照抄网页中的法条>", "source_url": "<原样复制来源URL>",
    "problem": "<问题说明>", "suggestion": "<可直接替换的改写文本>",
    "confidence": "high|medium|low", "need_human_review": <bool> } ],
  "coverage": [ { "clause": "<受审文本条款或章节,如 第十八条>", "topic": "<该条主题,如 会议通知期限>", "checked_against": ["<核对依据的外规名称>"], "status": "compliant|risk|partial|not_covered", "note": "<一句话结论>" } ]
}`;

// 组装 user message:受审文本全文 + 检索结果(只允许引用这些)
export function buildUserMessage(docText, regs, mode) {
  const lines = [];
  lines.push('# 受审文本全文');
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
  lines.push(`# 审查模式:${mode === 'full' ? '全文体检(对受审文本每一条都要核对,尽量全覆盖)' : '快速(只输出明确风险点)'}`);
  lines.push('请开始审查,严格按 System 中的 JSON 结构输出。');
  return lines.join('\n');
}

// 查漏复审(第二遍):基于已发现问题,专门找"遗漏的"问题
export const CRITIC_PROMPT = `你是合规审查复核专家。下面给你:受审文本全文、本次纳入的外规条文、以及"已发现的问题"清单。请再做一轮【查漏】:逐条核对受审文本与外规,找出【尚未发现的、被遗漏的】问题——尤其是"遗漏(omission)"类(外规强制要求某要素 / 职责 / 程序,受审文本全文未作规定),以及冲突、越权、标准过宽。
方法:把每条外规拆成若干"应当 / 必须"要点,逐一在受审文本全文中查找是否落实,缺失即为遗漏。
要求:
- 只输出【新增】问题,不要重复"已发现的问题"清单里的条目;若确无新增,findings 返回空数组。
- 同样遵守:零编造法条(reg_quote 须在所提供外规条文中逐字可找到)、零编造链接(source_url 原样复制对应 srcID 的 URL)、受审文本逐字引用(internal_quote 逐字照抄)、必标置信度。
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

// 让 AI 先读受审文本、判断它受哪些"具体法律法规"约束,产出联网检索词。
// 固定法域分类(与法规库 categories 标签一致)
export const LAW_CATEGORIES = ['公司治理', '上市公司', '证券', '银行', '财务公司', '银行保险', '票据', '信贷', '私募基金', '资管', '国资央企', '物流', '劳动', '数据', '反洗钱', '财税', '通用'];

export const TOPIC_PROMPT = `你是中国法律合规检索专家。阅读用户提供的企业内部制度全文,完成两件事:

一、判断它适用哪些【法域】(只能从下列固定项中选,可多选):
公司治理 / 上市公司 / 证券 / 银行 / 财务公司 / 银行保险 / 票据 / 信贷 / 私募基金 / 资管 / 国资央企 / 物流 / 劳动 / 数据 / 反洗钱 / 财税 / 通用
- 依据是"这份制度是谁的、管什么业务":如私募股权基金管理办法→私募基金、资管、证券;财务公司票据业务细则→财务公司、票据;商业银行内审制度→银行;国企采购或基金出资制度→国资央企。
- 【重要】不要把不相关的法域选进来:一份私募基金制度不要选银行、财务公司;一份银行制度不要选私募基金。宁缺毋滥,只选确属其监管范围的法域。
- "通用"(公司法、民法典、会计等普适法规)系统会默认带上,你可不必特意列出。

二、生成 3-7 条联网检索词(每条=具体法规名 + 主题词),用于补充库外的相关法规。

严格只输出单个 JSON,无任何其它文字:{"categories":["适用法域1","适用法域2"],"queries":["检索词1","检索词2"]}`;

export function buildTopicMessage(docText) {
  return '企业内部制度全文:\n<<<\n' + (docText || '').slice(0, 6000) + '\n>>>\n\n请按要求只输出 JSON。';
}

export const RISK_LABELS = {
  conflict: '直接冲突', omission: '遗漏要求', ultra_vires: '越权超范围',
  ambiguous: '表述模糊', wording: '措辞优化', outdated: '过时引用',
};
export const SEVERITY_LABELS = { high: '高', medium: '中', low: '低' };
