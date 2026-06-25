// review.js — 调用 OpenAI 兼容 Chat Completions 执行联网合规审查
// 设计契约见 README;仅依赖 config.js,不依赖 state.js。
// 浏览器原生 ES module。

import { SYSTEM_PROMPT, buildUserMessage, extractJSON, TOPIC_PROMPT, buildTopicMessage, CRITIC_PROMPT, buildCriticMessage } from './config.js';

// 合法的风险类型集合(用于兜底统计 counts)
const RISK_TYPES = ['conflict', 'omission', 'ultra_vires', 'ambiguous', 'wording', 'outdated'];

/**
 * 执行一轮合规审查。
 * @param {Object} p
 * @param {string} p.docText            内规全文
 * @param {Array}  p.regs               已选外规数组(含 id,title,clauseNo,quote,url)
 * @param {string} p.mode               'fast' | 'full'
 * @param {Object} p.settings           { modelEndpoint, modelName, modelKey, proxy }
 * @param {number} [p.round=1]          当前审查轮次
 * @returns {Promise<{summary:Object, findings:Array, suggestedSearches:Array}>}
 */
export async function runReview({ docText, regs, mode, settings, round = 1 }) {
  const s = settings || {};
  const modelKey = (s.modelKey || '').trim();
  if (!modelKey) {
    throw new Error('未配置 AI 模型 API Key,请在「设置」中填写');
  }

  const regList = Array.isArray(regs) ? regs : [];
  const endpoint = s.modelEndpoint || '';
  const url = s.proxy ? s.proxy + endpoint : endpoint;
  const modelName = s.modelName || '';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(docText, regList, mode) },
  ];

  const baseBody = {
    model: modelName,
    temperature: 0.2,
    max_tokens: 16000,
    messages,
  };

  // 第一次带 response_format=json_object;若 400 且报不支持 response_format,则去掉重试。
  let content;
  try {
    content = await callModel(url, modelKey, { ...baseBody, response_format: { type: 'json_object' } });
  } catch (err) {
    if (err && err._retryWithoutResponseFormat) {
      content = await callModel(url, modelKey, baseBody);
    } else {
      throw err;
    }
  }

  // 解析 JSON
  let obj;
  try {
    obj = extractJSON(content);
  } catch (e) {
    throw new Error('模型返回内容无法解析为 JSON:' + (e && e.message ? e.message : String(e)));
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('模型返回内容不是有效的 JSON 对象');
  }

  return normalize(obj, regList, round);
}

/**
 * 查漏复审(第二遍):基于已发现问题,找出被遗漏的新增问题。
 * @returns {Promise<{findings:Array}>} 仅新增的、已做反幻觉校验的 findings
 */
export async function reviewCritic({ docText, regs, existing, settings, round = 1 }) {
  const s = settings || {};
  const modelKey = (s.modelKey || '').trim();
  if (!modelKey) return { findings: [] };
  const regList = Array.isArray(regs) ? regs : [];
  const url = s.proxy ? s.proxy + (s.modelEndpoint || '') : (s.modelEndpoint || '');
  const messages = [
    { role: 'system', content: CRITIC_PROMPT },
    { role: 'user', content: buildCriticMessage(docText, regList, existing) },
  ];
  const base = { model: s.modelName || '', temperature: 0.2, max_tokens: 12000, messages };

  let content;
  try {
    content = await callModel(url, modelKey, { ...base, response_format: { type: 'json_object' } });
  } catch (err) {
    if (err && err._retryWithoutResponseFormat) {
      content = await callModel(url, modelKey, base);
    } else {
      throw err;
    }
  }

  let obj;
  try { obj = extractJSON(content); } catch (e) { return { findings: [] }; }
  const findings = Array.isArray(obj && obj.findings) ? obj.findings : [];

  // 反幻觉校验(同主审查)
  const urlSet = new Set();
  const idToUrl = new Map();
  regList.forEach((r) => {
    if (r && r.url) urlSet.add(r.url);
    if (r && r.id != null) idToUrl.set(String(r.id), r.url || '');
  });
  findings.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    f.round = f.round || round;
    if (!f.source_url && f.source_id != null && idToUrl.has(String(f.source_id))) {
      const hit = idToUrl.get(String(f.source_id));
      if (hit) f.source_url = hit;
    }
    f.verified = !!(f.source_url && urlSet.has(f.source_url));
    if (!f.verified) f.linkSuspect = true;
    // 用词统一:内规 → 受审文本
    if (typeof f.problem === 'string') f.problem = f.problem.replace(/内规/g, '受审文本');
    if (typeof f.suggestion === 'string') f.suggestion = f.suggestion.replace(/内规/g, '受审文本');
    if (typeof f.title === 'string') f.title = f.title.replace(/内规/g, '受审文本');
  });
  return { findings };
}

/**
 * 让模型读内规,提取用于联网检索"外规"的检索词(法律法规名 + 主题)。
 * @param {Object} p
 * @param {string} p.docText   内规全文
 * @param {Object} p.settings  { modelEndpoint, modelName, modelKey, proxy }
 * @returns {Promise<string[]>} 4-7 条检索词;失败时返回 [](由调用方兜底)
 */
export async function extractQueries({ docText, settings }) {
  const s = settings || {};
  const modelKey = (s.modelKey || '').trim();
  if (!modelKey) throw new Error('未配置 AI 模型 API Key,请在「设置」中填写');
  const url = s.proxy ? s.proxy + (s.modelEndpoint || '') : (s.modelEndpoint || '');
  const messages = [
    { role: 'system', content: TOPIC_PROMPT },
    { role: 'user', content: buildTopicMessage(docText) },
  ];
  const base = { model: s.modelName || '', temperature: 0.2, max_tokens: 700, messages };

  let content;
  try {
    content = await callModel(url, modelKey, { ...base, response_format: { type: 'json_object' } });
  } catch (err) {
    if (err && err._retryWithoutResponseFormat) {
      content = await callModel(url, modelKey, base);
    } else {
      throw err;
    }
  }

  let obj;
  try {
    obj = extractJSON(content);
  } catch (e) {
    return [];
  }
  const qs = Array.isArray(obj && obj.queries) ? obj.queries : [];
  return qs.filter((q) => typeof q === 'string' && q.trim()).map((q) => q.trim()).slice(0, 7);
}

/**
 * 发送一次请求并取回 message.content。
 * 若疑似不支持 response_format(状态码 400 且 message 含 response_format),
 * 抛出带 _retryWithoutResponseFormat 标志的 Error 由上层重试。
 */
async function callModel(url, modelKey, body) {
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + modelKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    // 网络层异常(CORS、断网、DNS 等)
    throw new Error('调用 AI 模型失败(网络错误,可在「设置」中配置代理前缀绕过 CORS):' + (netErr && netErr.message ? netErr.message : String(netErr)));
  }

  if (!resp.ok) {
    const raw = await safeText(resp);
    const msg = extractErrorMessage(raw);
    // 判断是否疑似不支持 response_format
    if (resp.status === 400 && /response_format/i.test(raw || '') && body.response_format) {
      const e = new Error('模型不支持 response_format');
      e._retryWithoutResponseFormat = true;
      throw e;
    }
    throw new Error(`调用 AI 模型失败(HTTP ${resp.status}):${msg || raw || '无返回内容'}`);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    throw new Error('AI 模型返回内容不是合法 JSON,无法读取');
  }

  const content = data
    && data.choices
    && data.choices[0]
    && data.choices[0].message
    && data.choices[0].message.content;

  if (!content || !String(content).trim()) {
    throw new Error('AI 模型返回为空,未取得审查结果');
  }
  return content;
}

// 安全读取响应文本,不抛异常
async function safeText(resp) {
  try {
    return await resp.text();
  } catch (e) {
    return '';
  }
}

// 从错误响应体中尽量提取人类可读的 message
function extractErrorMessage(raw) {
  if (!raw) return '';
  try {
    const j = JSON.parse(raw);
    if (j && j.error) {
      if (typeof j.error === 'string') return j.error;
      if (j.error.message) return j.error.message;
    }
    if (j && j.message) return j.message;
  } catch (e) {
    // 非 JSON,原样返回截断后的文本
  }
  return String(raw).slice(0, 500);
}

/**
 * 规整模型返回:补 round、反幻觉校验、summary 兜底统计与评分、suggestedSearches。
 */
function normalize(obj, regs, round) {
  // ── findings ──
  const findings = Array.isArray(obj.findings) ? obj.findings : [];

  // 用 regs 的 url 建立 Set(去掉空值);id -> url 映射用于按 source_id 补链。
  const urlSet = new Set();
  const idToUrl = new Map();
  regs.forEach((r) => {
    if (r && r.url) urlSet.add(r.url);
    if (r && r.id != null) idToUrl.set(String(r.id), r.url || '');
  });

  findings.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    // 补轮次
    f.round = f.round || round;

    // 若 source_url 缺失但 source_id 命中 regs,则补 source_url
    if (!f.source_url && f.source_id != null && idToUrl.has(String(f.source_id))) {
      const hit = idToUrl.get(String(f.source_id));
      if (hit) f.source_url = hit;
    }

    // 反幻觉校验:source_url 必须在 regs 的 url 集合内
    f.verified = !!(f.source_url && urlSet.has(f.source_url));
    if (!f.verified) {
      f.linkSuspect = true;
    } else {
      // 校验通过时清除可能存在的可疑标记
      if (f.linkSuspect) f.linkSuspect = false;
    }
  });

  // ── summary ──
  const summary = buildSummary(obj.summary, findings);

  // ── suggestedSearches ──
  let suggestedSearches = obj.suggested_searches || obj.suggestedSearches || [];
  if (!Array.isArray(suggestedSearches)) suggestedSearches = [];

  // ── coverage(审查覆盖·逐条对照)──
  let coverage = obj.coverage || [];
  if (!Array.isArray(coverage)) coverage = [];

  // ── 用词统一:模型偶尔仍说"内规",一律改为"受审文本"(逐字引用字段不动)──
  const fix = (s) => (typeof s === 'string' ? s.replace(/内规/g, '受审文本') : s);
  findings.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    f.problem = fix(f.problem); f.suggestion = fix(f.suggestion); f.title = fix(f.title);
  });
  coverage.forEach((c) => {
    if (!c || typeof c !== 'object') return;
    c.note = fix(c.note); c.topic = fix(c.topic);
  });

  return { summary, findings, suggestedSearches, coverage };
}

/**
 * 构造/补全 summary。
 * 若模型给出的 summary 缺失或 counts 缺失,则按 findings 重新统计并评分。
 */
function buildSummary(rawSummary, findings) {
  const hasSummary = rawSummary && typeof rawSummary === 'object';
  const hasCounts = hasSummary && rawSummary.counts && typeof rawSummary.counts === 'object';

  if (hasSummary && hasCounts) {
    // 模型给的 summary 足够完整,直接采用(但确保字段类型合理)
    return rawSummary;
  }

  // 兜底:根据 findings 的 risk_type 统计 counts
  const counts = { conflict: 0, omission: 0, ultra_vires: 0, ambiguous: 0, wording: 0, outdated: 0 };
  findings.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    const t = f.risk_type;
    if (RISK_TYPES.includes(t)) {
      counts[t] = (counts[t] || 0) + 1;
    }
  });

  // 按 severity 计分:high*12 / medium*5 / low*2,wording 不计。
  let high = 0;
  let medium = 0;
  let low = 0;
  findings.forEach((f) => {
    if (!f || typeof f !== 'object') return;
    if (f.risk_type === 'wording') return; // wording 不扣分
    const sev = f.severity;
    if (sev === 'high') high += 1;
    else if (sev === 'medium') medium += 1;
    else if (sev === 'low') low += 1;
  });

  let score = 100 - high * 12 - medium * 5 - low * 2;
  if (score < 0) score = 0;

  const risk_level = score < 60 ? 'high' : (score < 80 ? 'medium' : 'low');

  const score_breakdown = `基础分100;高危 ${high}×12=${high * 12},中危 ${medium}×5=${medium * 5},低危 ${low}×2=${low * 2}(措辞不计);最终得分 ${score}`;

  return { score, score_breakdown, risk_level, counts };
}
