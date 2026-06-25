// report.js — 报告渲染层(范本式「三栏对照表」)
// 每条发现 = 一行三栏:现行制度原文 | 审查结论 | 外规依据(带链接),横向对齐、一眼对上。
// 渲染进 #report-root;审查依据(#review-basis)与逐条覆盖(#coverage)由 app.js 渲染。

import { RISK_LABELS, SEVERITY_LABELS } from './config.js';

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function clampScore(n) {
  n = Number(n);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function sevOf(s) { return (s === 'high' || s === 'medium' || s === 'low') ? s : 'medium'; }
function confLabel(c) {
  if (c === 'high' || c === 'medium' || c === 'low') return SEVERITY_LABELS[c];
  const n = Number(c);
  if (isFinite(n) && c !== '' && c !== null) {
    const pct = n <= 1 ? n * 100 : n; // 0~1 小数(如 0.95)按百分比换算
    return pct >= 80 ? '高' : (pct >= 60 ? '中' : '低');
  }
  return c || '—';
}

function scoreRing(score, color) {
  return '<div class="score-ring"><svg viewBox="0 0 36 36" role="img" aria-label="合规评分 ' + score + '">' +
    '<circle cx="18" cy="18" r="15.9" fill="none" stroke="#eceff3" stroke-width="3"></circle>' +
    '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + score + ' 100"></circle>' +
    '</svg><div class="num">' + score + '</div></div>';
}

// 外规依据列:法规名+条款号 + 逐字法条 + 原文出处链接
function extCol(f) {
  let h = '<div class="fg-cite">' + esc(f.reg_name || '') + ' ' + esc(f.reg_clause_no || '') + '</div>';
  if (f.reg_quote) h += '<div class="fg-quote">“' + esc(f.reg_quote) + '”</div>';
  if (f.source_url) {
    h += '<a class="lk" href="' + esc(f.source_url) + '" target="_blank" rel="noopener">原文出处 <i class="ti ti-external-link" aria-hidden="true"></i></a>';
  }
  if (f.linkSuspect) h += '<span class="suspect">链接存疑,请人工核对</span>';
  return h;
}

function findingBlock(f) {
  const sv = sevOf(f.severity);
  const typeLabel = RISK_LABELS[f.risk_type] || '风险';
  const head = esc(typeLabel) + ' · ' + esc(f.internal_clause_no || '') + (f.title ? ' · ' + esc(f.title) : '');
  const concl = '<div class="fg-text">' + esc(f.problem || '') + '</div>' +
    (f.suggestion ? '<div class="fg-sugg"><span class="fg-sugg-cap">修改建议</span>' + esc(f.suggestion) + '</div>' : '');
  return '<div class="finding" id="card-' + esc(f.id) + '" data-decision="' + esc(f.decision || '') + '">' +
    '<div class="fcap sev-' + sv + '"><span class="fcap-title">' + head + '</span>' +
      '<span class="fcap-right">' +
        '<span class="fstamp s-adopt"><i class="ti ti-stamp" aria-hidden="true"></i> 已采纳</span>' +
        '<span class="fstamp s-ignore"><i class="ti ti-ban" aria-hidden="true"></i> 已忽略</span>' +
        '<span class="conf">置信度:' + esc(confLabel(f.confidence)) + (f.need_human_review ? ' · 待复核' : '') + '</span>' +
      '</span></div>' +
    '<div class="finding-grid">' +
      '<div class="fg-col fg-internal"><div class="fg-h">受审文本原文</div>' +
        (f.internal_clause_no ? '<div class="fg-clause">' + esc(f.internal_clause_no) + '</div>' : '') +
        '<div class="fg-text"><mark class="fg-hl">' + esc(f.internal_quote || '') + '</mark></div></div>' +
      '<div class="fg-col fg-concl"><div class="fg-h">审查结论</div>' + concl + '</div>' +
      '<div class="fg-col fg-ext"><div class="fg-h">外规依据</div>' + extCol(f) + '</div>' +
    '</div>' +
    '<div class="factions"><button class="btn adopt">采纳</button>' +
      '<button class="btn fignore">忽略</button></div>' +
  '</div>';
}

function gapCard(g) {
  const kws = Array.isArray(g.keywords) ? g.keywords : [];
  return '<div class="gap-card" data-kw="' + esc(JSON.stringify(kws)) + '">' +
    '<div class="gt"><i class="ti ti-search" aria-hidden="true"></i> 查漏提示</div>' +
    '<div class="gap-row"><span>' + esc(g.rationale || '') +
      (kws.length ? ' 关键词:' + esc(kws.join('、')) : '') + '</span>' +
      '<button class="btn gap-re">补搜并重审</button></div></div>';
}

export function renderReport(root, result, ctx) {
  if (!root) throw new Error('渲染报告失败:未提供容器节点');
  result = result || {};
  ctx = ctx || {};
  const summary = result.summary || {};
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const gaps = Array.isArray(result.suggestedSearches) ? result.suggestedSearches : [];

  const score = clampScore(summary.score);
  const ringColor = score < 60 ? '#c0392b' : (score < 80 ? '#9a6700' : '#1d7a55');
  const rl = summary.risk_level === 'high' ? 'high' : summary.risk_level === 'low' ? 'low' : (summary.risk_level || 'medium');
  const rlText = rl === 'high' ? '高' : rl === 'low' ? '低' : '中';
  const counts = summary.counts || {};
  const regUrls = new Set();
  findings.forEach((f) => { if (f && f.source_url) regUrls.add(f.source_url); });
  const regCount = regUrls.size || ctx.regCount || 0;

  let html = '';
  // 概览
  html += '<div class="ov">' + scoreRing(score, ringColor) +
    '<div class="ov-meta"><span class="risk-badge risk-' + rl + '">风险等级:' + rlText + '</span>' +
      '<div class="ov-break">' + esc(summary.score_breakdown || '') + '</div></div>' +
    '<div class="ov-cards">' +
      metric('风险点总数', findings.length) +
      metric('引用法规数', regCount) +
      metric('冲突数', counts.conflict || 0) +
      metric('遗漏数', counts.omission || 0) +
    '</div></div>';
  // 指纹
  html += '<div class="fingerprint"><i class="ti ti-fingerprint" aria-hidden="true"></i> ' +
    esc(ctx.fingerprint || '') + ' · ' + esc(ctx.modelName || '') + ' · 第' + esc(ctx.round || 1) + '轮 · ' +
    esc(ctx.fileName || '') + '</div>';
  // 处置汇总(采纳/忽略留痕,随报告导出)
  if (findings.length) html += '<div id="decision-summary" class="decision-summary"></div>';
  // 导出按钮(app.js 会替换为「下载 PDF」)
  html += '<div class="report-actions"><button class="btn btn-primary">导出 PDF</button></div>';
  // 发现
  if (!findings.length) {
    html += '<div class="empty">未发现明显风险点</div>';
  } else {
    html += '<div class="findings-list">';
    findings.forEach((f) => { html += findingBlock(f); });
    html += '</div>';
  }
  // 查漏提示
  if (gaps.length) {
    html += '<div class="gaps">';
    gaps.forEach((g) => { html += gapCard(g); });
    html += '</div>';
  }
  root.innerHTML = html;

  // 交互绑定
  bind(root, ctx, findings);
}

function metric(k, v) {
  return '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(v) + '</div></div>';
}

function updateDecisionSummary(root, findings) {
  const el = root.querySelector('#decision-summary');
  if (!el) return;
  const n = (findings || []).length;
  let a = 0, ig = 0;
  (findings || []).forEach((f) => { if (f && f.decision === 'adopted') a++; else if (f && f.decision === 'ignored') ig++; });
  const pending = n - a - ig;
  el.innerHTML = '<i class="ti ti-clipboard-check" aria-hidden="true"></i> 处置进度:共 <b>' + n + '</b> 条 · ' +
    '<span class="ds-a">已采纳 ' + a + '</span> · <span class="ds-i">已忽略 ' + ig + '</span> · <span class="ds-p">待定 ' + pending + '</span>';
}
function bind(root, ctx, findings) {
  root.querySelectorAll('.finding').forEach((card) => {
    const id = card.id.replace(/^card-/, '');
    const f = (findings || []).find((x) => x && x.id === id);
    const adopt = card.querySelector('.adopt');
    const ignore = card.querySelector('.fignore');
    const apply = (d) => {
      if (f) f.decision = d || undefined;
      card.setAttribute('data-decision', d || '');
      if (adopt) adopt.classList.toggle('active', d === 'adopted');
      if (ignore) ignore.classList.toggle('active', d === 'ignored');
      updateDecisionSummary(root, findings);
      safe(d === 'ignored' ? ctx.onIgnore : ctx.onAdopt, id);
    };
    // 初始按钮高亮(若已有决定)
    const cur = f && f.decision;
    if (adopt) adopt.classList.toggle('active', cur === 'adopted');
    if (ignore) ignore.classList.toggle('active', cur === 'ignored');
    if (adopt) adopt.addEventListener('click', () => apply((f && f.decision === 'adopted') ? '' : 'adopted'));
    if (ignore) ignore.addEventListener('click', () => apply((f && f.decision === 'ignored') ? '' : 'ignored'));
  });
  updateDecisionSummary(root, findings);
  root.querySelectorAll('.gap-card').forEach((gc) => {
    const btn = gc.querySelector('.gap-re');
    if (!btn) return;
    btn.addEventListener('click', () => {
      let kws = [];
      try { kws = JSON.parse(gc.getAttribute('data-kw') || '[]'); } catch (e) { kws = []; }
      safe(ctx.onReReview, kws);
    });
  });
}
function safe(fn, arg) { try { if (typeof fn === 'function') fn(arg); } catch (e) { /* 回调异常不影响渲染 */ } }

export function exportPDF() { window.print(); }
