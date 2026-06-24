// report.js — 报告渲染层
// 把审查结果(summary / findings / suggestedSearches)渲染进 #report-root,
// 并绑定左右联动、采纳/修改/忽略、查漏补搜重审、导出 PDF 等交互。
// 仅依赖 config.js 的标签常量与 styles.css 中已存在的 class,不引入第三方库。

import { RISK_LABELS, SEVERITY_LABELS } from './config.js';

// ── 工具:HTML 转义 ────────────────────────────────────────────────
// 原文/法条中可能含 < > & " ' 等字符,统一转义,避免破坏 DOM 结构或注入。
function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── 工具:正则转义(用于在原文中按字面量查找 internal_quote)──────────
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 工具:把任意值安全转成字符串(防止对象/数字插入报错)────────────
function s(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// 严重程度归一化:只接受 high|medium|low,其它一律按 low 处理。
function normSev(v) {
  const t = s(v).toLowerCase();
  return (t === 'high' || t === 'medium' || t === 'low') ? t : 'low';
}

// 风险等级 → risk-badge class
function riskBadgeClass(level) {
  const t = s(level).toLowerCase();
  if (t === 'high') return 'risk-high';
  if (t === 'medium') return 'risk-medium';
  return 'risk-low';
}

// 分数环的描边颜色
function ringColor(score) {
  if (score < 60) return '#c0392b';
  if (score < 80) return '#9a6700';
  return '#1d7a55';
}

// ── 主渲染函数 ────────────────────────────────────────────────────
export function renderReport(root, result, ctx) {
  if (!root) throw new Error('渲染报告失败:未提供容器节点');
  ctx = ctx || {};
  result = result || {};

  const summary = (result && typeof result.summary === 'object' && result.summary) ? result.summary : {};
  const findings = Array.isArray(result.findings) ? result.findings : [];
  const suggested = Array.isArray(result.suggestedSearches) ? result.suggestedSearches : [];

  // 给每条 finding 兜底一个稳定 id(用于卡片锚点与左右联动)。
  findings.forEach((f, i) => {
    if (!f) return;
    if (f.id === null || f.id === undefined || f.id === '') f.id = 'F' + (i + 1);
  });

  // —— 概览数据 ——
  let score = Number(summary.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const riskLevel = s(summary.risk_level) || 'low';
  const breakdown = s(summary.score_breakdown);

  // 引用法规数:findings 中不同 source_url 去重计数,空时用 ctx.regCount 兜底。
  const urlSet = new Set();
  findings.forEach((f) => {
    const u = f && s(f.source_url).trim();
    if (u) urlSet.add(u);
  });
  let citedCount = urlSet.size;
  if (citedCount === 0 && Number.isFinite(Number(ctx.regCount))) {
    citedCount = Number(ctx.regCount);
  }

  // 冲突数 / 遗漏数:优先用 summary.counts,缺失则按 findings 统计。
  const counts = (summary && typeof summary.counts === 'object' && summary.counts) ? summary.counts : {};
  let conflictCount = Number(counts.conflict);
  let omissionCount = Number(counts.omission);
  if (!Number.isFinite(conflictCount)) {
    conflictCount = findings.filter((f) => f && f.risk_type === 'conflict').length;
  }
  if (!Number.isFinite(omissionCount)) {
    omissionCount = findings.filter((f) => f && f.risk_type === 'omission').length;
  }

  const total = findings.length;

  // —— 拼装 HTML ——
  const parts = [];

  // 概览块
  parts.push('<section class="ov">');
  parts.push(
    '<div class="score-ring">' +
      '<svg viewBox="0 0 36 36">' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="#e6e6e6" stroke-width="3"></circle>' +
        '<circle cx="18" cy="18" r="15.9" fill="none" stroke="' + ringColor(score) + '" stroke-width="3" ' +
          'stroke-linecap="round" stroke-dasharray="' + score + ' 100" transform="rotate(-90 18 18)"></circle>' +
      '</svg>' +
      '<div class="num">' + score + '</div>' +
    '</div>'
  );
  parts.push('<div class="ov-meta">');
  parts.push('<span class="risk-badge ' + riskBadgeClass(riskLevel) + '">风险等级:' + esc(SEVERITY_LABELS[s(riskLevel).toLowerCase()] || riskLevel || '低') + '</span>');
  if (breakdown) parts.push('<small>' + esc(breakdown) + '</small>');
  parts.push('</div>');

  parts.push('<div class="ov-cards">');
  parts.push(metric('风险点总数', total));
  parts.push(metric('引用法规数', citedCount));
  parts.push(metric('冲突数', conflictCount));
  parts.push(metric('遗漏数', omissionCount));
  parts.push('</div>');
  parts.push('</section>');

  // 指纹行
  const fpBits = [];
  if (ctx.fingerprint) fpBits.push(esc(ctx.fingerprint));
  if (ctx.modelName) fpBits.push(esc(ctx.modelName));
  fpBits.push('第' + esc(s(ctx.round) || '1') + '轮');
  if (ctx.fileName) fpBits.push(esc(ctx.fileName));
  parts.push(
    '<div class="fingerprint">' +
      '<i class="ti ti-fingerprint"></i> ' +
      fpBits.join(' · ') +
    '</div>'
  );

  // 操作区
  parts.push(
    '<div class="report-actions">' +
      '<button type="button" class="btn btn-primary" data-act="export-pdf">' +
        '<i class="ti ti-file-type-pdf"></i> 导出 PDF(含法条链接)' +
      '</button>' +
    '</div>'
  );

  // 主体两栏
  parts.push('<div class="console">');

  // 左:制度原文
  parts.push('<div class="doc-pane">');
  parts.push('<div class="pane-title">制度原文</div>');
  parts.push(renderDoc(s(ctx.docText), findings));
  parts.push('</div>');

  // 右:风险点
  parts.push('<div class="findings-pane">');
  if (findings.length === 0) {
    parts.push('<div class="empty">未发现明显风险点</div>');
  } else {
    findings.forEach((f) => { parts.push(renderFinding(f)); });
  }
  // 查漏提示卡
  suggested.forEach((g) => {
    if (!g) return;
    const keywords = Array.isArray(g.keywords) ? g.keywords : [];
    const rationale = s(g.rationale) || s(g.trigger_clause_no);
    parts.push(
      '<div class="gap-card">' +
        '<div class="gt"><i class="ti ti-search"></i> 查漏提示</div>' +
        '<div class="gap-row">' +
          '<div>' + esc(rationale || '建议补充检索后重审') +
            (keywords.length ? '<br><small>关键词:' + esc(keywords.join('、')) + '</small>' : '') +
          '</div>' +
          '<button type="button" class="btn" data-act="re-review" data-keywords="' +
            esc(JSON.stringify(keywords)) + '">补搜并重审</button>' +
        '</div>' +
      '</div>'
    );
  });
  parts.push('</div>'); // /findings-pane

  parts.push('</div>'); // /console

  // 一次性写入
  root.innerHTML = parts.join('');

  // —— 绑定交互 ——
  bindEvents(root, findings, ctx);
}

// 单个 metric 卡片
function metric(k, v) {
  return '<div class="metric"><div class="k">' + esc(k) + '</div><div class="v">' + esc(s(v)) + '</div></div>';
}

// 渲染左侧原文:按换行拆段,并对每条 finding 的 internal_quote 做首次命中高亮。
function renderDoc(docText, findings) {
  if (!docText) return '<div class="para">(未提供原文)</div>';

  // 先把全文转义,再在转义后的文本上查找“转义后的 quote”,做高亮包裹。
  // 这样可避免高亮标签本身被二次转义,也保证查找基于同一份转义文本。
  let html = esc(docText);

  // 逐条处理,记录已被包裹区间,避免重叠(后一条命中落在已包裹区间内则跳过)。
  const wrapped = []; // [start, end) 区间(基于当前 html 字符串)
  (findings || []).forEach((f) => {
    if (!f) return;
    const raw = s(f.internal_quote).trim();
    if (!raw) return;
    const needle = esc(raw);
    if (!needle) return;

    // 在 html 中找首个不与已包裹区间重叠的命中。
    const re = new RegExp(escapeRegExp(needle), 'g');
    let m;
    while ((m = re.exec(html)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const overlap = wrapped.some((w) => start < w.end && end > w.start);
      if (overlap) continue; // 跳过此命中,找下一处

      const sev = normSev(f.severity);
      const open = '<span class="hi ' + sev + '" data-fid="' + esc(s(f.id)) + '">';
      const close = '</span>';
      html = html.slice(0, start) + open + m[0] + close + html.slice(end);

      // 记录新区间(注意已插入标签会改变后续偏移,故重算所有区间最简单的方式:
      // 把已存在区间中位于 start 之后的整体右移 open+close 的长度)。
      const delta = open.length + close.length;
      wrapped.forEach((w) => {
        if (w.start >= start) { w.start += delta; w.end += delta; }
      });
      wrapped.push({ start: start, end: end + open.length });
      break; // 每条 finding 只包裹首次命中
    }
  });

  // 按换行拆段
  const segs = html.split(/\r?\n/);
  const out = [];
  segs.forEach((seg) => {
    // 空行也保留一个占位段,维持原文视觉间距
    out.push('<div class="para">' + (seg.length ? seg : '&nbsp;') + '</div>');
  });
  return out.join('');
}

// 渲染单条 finding 卡片
function renderFinding(f) {
  if (!f) return '';
  const id = s(f.id);
  const sev = normSev(f.severity);
  const riskLabel = RISK_LABELS[s(f.risk_type)] || s(f.risk_type) || '风险点';
  const clauseNo = s(f.internal_clause_no);
  const confLabel = SEVERITY_LABELS[s(f.confidence).toLowerCase()] || s(f.confidence) || '中';

  const sourceUrl = s(f.source_url).trim();
  const linkSuspect = !!f.linkSuspect;

  const titleText = riskLabel + (clauseNo ? ' · ' + clauseNo : '');

  const html = [];
  html.push('<div class="fcard" id="card-' + esc(id) + '">');

  // 标题栏
  html.push('<div class="fcap sev-' + sev + '">');
  html.push('<span>' + esc(titleText) + '</span>');
  html.push('<span class="conf">置信度:' + esc(confLabel) +
    (f.need_human_review ? ' · 待复核' : '') + '</span>');
  html.push('</div>');

  // 主体
  html.push('<div class="fbody">');

  // 问题说明
  html.push('<div class="fprob"><span class="lead">提示:</span>' + esc(s(f.problem)) + '</div>');

  // 引用法条
  html.push('<div class="citation' + (linkSuspect ? ' bad' : '') + '">');
  html.push('<div class="cap">引用法条</div>');
  const regLine = (s(f.reg_name) + (f.reg_clause_no ? ' ' + s(f.reg_clause_no) : '')).trim();
  html.push('<div class="quote">' + esc(regLine) + ':“' + esc(s(f.reg_quote)) + '”</div>');
  if (sourceUrl) {
    html.push('<a class="lk" href="' + esc(sourceUrl) + '" target="_blank" rel="noopener noreferrer">原文出处</a>');
    if (linkSuspect) html.push('<span class="suspect">链接存疑,请人工核对</span>');
  } else if (linkSuspect) {
    html.push('<span class="suspect">链接存疑,请人工核对</span>');
  }
  html.push('</div>'); // /citation

  // 内规原文
  html.push('<div class="fquote-int">内规原文:' + esc(s(f.internal_quote)) + '</div>');

  // 修改建议
  html.push('<div class="suggestion">');
  html.push('<div class="cap">修改建议</div>');
  html.push('<p>' + esc(s(f.suggestion)) + '</p>');
  html.push('</div>');

  // 操作按钮
  html.push('<div class="factions">');
  html.push('<button type="button" class="btn adopt" data-act="adopt" data-id="' + esc(id) + '">采纳</button>');
  html.push('<button type="button" class="btn" data-act="edit" data-id="' + esc(id) + '">修改</button>');
  html.push('<button type="button" class="btn" data-act="ignore" data-id="' + esc(id) + '">忽略</button>');
  html.push('</div>');

  html.push('</div>'); // /fbody
  html.push('</div>'); // /fcard
  return html.join('');
}

// 绑定所有交互(事件委托 + 直接绑定)
function bindEvents(root, findings, ctx) {
  // 导出 PDF
  const pdfBtn = root.querySelector('[data-act="export-pdf"]');
  if (pdfBtn) pdfBtn.addEventListener('click', () => { try { exportPDF(); } catch (e) { /* 静默 */ } });

  // 左侧高亮 → 定位右侧卡片并闪烁
  root.querySelectorAll('.doc-pane .hi').forEach((hi) => {
    hi.addEventListener('click', () => {
      const fid = hi.getAttribute('data-fid');
      if (!fid) return;
      const card = root.querySelector('#card-' + cssEscape(fid));
      if (!card) return;
      root.querySelectorAll('.fcard.flash').forEach((c) => c.classList.remove('flash'));
      card.classList.add('flash');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });

  // 右侧卡片点击 → 高亮左侧原文(避免点到按钮/链接时触发)
  root.querySelectorAll('.findings-pane .fcard').forEach((card) => {
    card.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t && t.closest && t.closest('button, a')) return;
      const id = (card.id || '').replace(/^card-/, '');
      if (!id) return;
      root.querySelectorAll('.doc-pane .hi.active').forEach((h) => h.classList.remove('active'));
      const hi = root.querySelector('.doc-pane .hi[data-fid="' + cssAttr(id) + '"]');
      if (hi) {
        hi.classList.add('active');
        hi.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  });

  // 采纳 / 修改 / 忽略
  root.querySelectorAll('.factions [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      const card = root.querySelector('#card-' + cssEscape(id));
      if (act === 'adopt') {
        btn.textContent = '已采纳';
        btn.classList.add('done');
        if (card) card.classList.add('adopted');
        if (typeof ctx.onAdopt === 'function') safeCall(ctx.onAdopt, id);
      } else if (act === 'ignore') {
        if (card) card.classList.add('ignored');
        if (typeof ctx.onIgnore === 'function') safeCall(ctx.onIgnore, id);
      } else if (act === 'edit') {
        if (typeof ctx.onEdit === 'function') safeCall(ctx.onEdit, id);
      }
    });
  });

  // 补搜并重审
  root.querySelectorAll('[data-act="re-review"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      let kws = [];
      try { kws = JSON.parse(btn.getAttribute('data-keywords') || '[]'); } catch (e) { kws = []; }
      if (!Array.isArray(kws)) kws = [];
      if (typeof ctx.onReReview === 'function') safeCall(ctx.onReReview, kws);
    });
  });
}

// 安全调用回调:回调内部抛错不应中断渲染层。
function safeCall(fn, arg) {
  try { fn(arg); } catch (e) { /* 调用方回调异常,静默吞掉 */ }
}

// 用于 querySelector 的简易转义(id 一般是 F1/F2 这类安全字符,这里做兜底)。
function cssEscape(v) {
  const str = s(v);
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(str);
  return str.replace(/[^a-zA-Z0-9_\-]/g, '\\$&');
}

// 用于属性选择器值的转义(转义引号与反斜杠)。
function cssAttr(v) {
  return s(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ── 导出 PDF:走浏览器打印(styles.css 中有 @media print 适配)──────
export function exportPDF() { window.print(); }
