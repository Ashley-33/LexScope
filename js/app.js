// app.js — 集成层:设置、上传、全自动审查流水线、报告联动
import { state, nextRegId } from './state.js';
import { getSettings, saveSettings, LAW_DOMAINS } from './config.js';
import { parseFile } from './parse.js';
import { searchRegulations } from './search.js';
import { runReview, extractQueries, reviewCritic } from './review.js';
import { renderReport } from './report.js';
import { selectLibraryClauses } from './lawlib.js';

// 合并两轮 findings(按 受审文本条款+外规条款+类型 去重)
function mergeFindings(a, b) {
  const key = (f) => (f.internal_clause_no || '') + '|' + (f.reg_clause_no || '') + '|' + (f.risk_type || '') + '|' + (f.internal_quote || '').slice(0, 18);
  const map = new Map();
  [...(a || []), ...(b || [])].forEach((f) => { if (f && typeof f === 'object') map.set(key(f), f); });
  return [...map.values()];
}
// 合并后重算评分与计数
function recomputeSummary(findings) {
  const counts = { conflict: 0, omission: 0, ultra_vires: 0, ambiguous: 0, wording: 0, outdated: 0 };
  let high = 0, med = 0, low = 0;
  (findings || []).forEach((f) => {
    if (!f || typeof f !== 'object') return;
    if (counts[f.risk_type] != null) counts[f.risk_type]++;
    if (f.risk_type === 'wording') return;
    if (f.severity === 'high') high++;
    else if (f.severity === 'medium') med++;
    else if (f.severity === 'low') low++;
  });
  const score = Math.max(0, 100 - high * 12 - med * 5 - low * 2);
  return {
    score,
    risk_level: score < 60 ? 'high' : (score < 80 ? 'medium' : 'low'),
    score_breakdown: `基础分100;高 ${high}×12、中 ${med}×5、低 ${low}×2(措辞不计);得分 ${score}`,
    counts,
  };
}

const $ = (sel) => document.querySelector(sel);
let currentStep = 1;
let reviewCount = 0;

// ---------- 通用提示 ----------
let toastTimer = null;
function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3600);
}

// ---------- 设置 ----------
function loadSettingsToForm() {
  const s = getSettings();
  $('#set-endpoint').value = s.modelEndpoint;
  $('#set-model').value = s.modelName;
  $('#set-model-key').value = s.modelKey;
  $('#set-search-provider').value = s.searchProvider;
  $('#set-search-key').value = s.searchKey;
  $('#set-proxy').value = s.proxy;
}
function openSettings() { $('#settings-overlay').hidden = false; loadSettingsToForm(); }
function closeSettings() { $('#settings-overlay').hidden = true; }
function bindSettings() {
  $('#btn-settings').addEventListener('click', () => {
    if ($('#settings-overlay').hidden) openSettings(); else closeSettings();
  });
  $('#btn-close-settings').addEventListener('click', closeSettings);
  // 点遮罩空白处关闭(只在点到遮罩本身、而非弹窗内部时)
  $('#settings-overlay').addEventListener('click', (e) => {
    if (e.target === $('#settings-overlay')) closeSettings();
  });
  // Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#settings-overlay').hidden) closeSettings();
  });
  $('#btn-save-settings').addEventListener('click', () => {
    saveSettings({
      modelEndpoint: $('#set-endpoint').value.trim(),
      modelName: $('#set-model').value.trim(),
      modelKey: $('#set-model-key').value.trim(),
      searchProvider: $('#set-search-provider').value,
      searchKey: $('#set-search-key').value.trim(),
      proxy: $('#set-proxy').value.trim(),
    });
    toast('设置已保存');
    closeSettings();
  });
}

// ---------- 帮助文档弹窗 ----------
function bindHelp() {
  const ov = $('#help-overlay');
  $('#btn-help').addEventListener('click', () => { ov.hidden = !ov.hidden; });
  $('#btn-close-help').addEventListener('click', () => { ov.hidden = true; });
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.hidden) ov.hidden = true; });
}

// ---------- 步骤导航(两步:上传 / 报告)----------
function gotoStep(n) {
  currentStep = n;
  $('#step-1').hidden = (n !== 1);
  $('#step-2').hidden = (n !== 2);
  $('#step-3').hidden = (n !== 3);
  document.querySelectorAll('.stepper .si').forEach((si) => {
    const s = +si.dataset.s;
    si.classList.toggle('on', s === n);
    si.classList.toggle('done', s < n);
  });
  const prev = $('#btn-prev'), next = $('#btn-next');
  if (n === 1) {
    next.style.visibility = 'visible';
    next.disabled = false;
    next.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> 开始审查';
    prev.style.visibility = 'hidden';
  } else if (n === 2) {
    // 分析中:底部导航隐藏(出错时由 runAutoFlow 再显示「重新上传」)
    next.style.visibility = 'hidden';
    prev.style.visibility = 'hidden';
  } else {
    next.style.visibility = 'hidden';
    prev.style.visibility = 'visible';
  }
}

// ---------- 步骤1:上传/解析 ----------
function setFileStatus(html, cls) {
  const el = $('#file-status');
  el.hidden = false;
  el.className = 'file-status' + (cls ? ' ' + cls : '');
  el.innerHTML = html;
}
async function handleFile(file) {
  if (!file) return;
  state.doc.status = 'parsing';
  setFileStatus('<i class="ti ti-loader-2 spin"></i> 正在解析 ' + esc(file.name) + ' …');
  try {
    const { name, text } = await parseFile(file, (msg) => {
      setFileStatus('<i class="ti ti-loader-2 spin"></i> ' + esc(msg));
    });
    state.doc = { name, text, status: 'ready' };
    setFileStatus('<i class="ti ti-file-check"></i> ' + esc(name) + ' 已就绪(' + text.length + ' 字),点下方「开始审查」', 'ok');
  } catch (e) {
    state.doc.status = 'error';
    setFileStatus('<i class="ti ti-alert-circle"></i> 解析失败:' + esc(e.message || String(e)), 'err');
  }
}
function bindUpload() {
  const dz = $('#dropzone');
  const input = $('#file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => handleFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  $('#btn-use-paste').addEventListener('click', () => {
    const txt = $('#paste-text').value.trim();
    if (!txt) { toast('请先粘贴文本', true); return; }
    state.doc = { name: '粘贴文本.txt', text: txt, status: 'ready' };
    setFileStatus('<i class="ti ti-file-check"></i> 已使用粘贴文本(' + txt.length + ' 字),点下方「开始审查」', 'ok');
  });
}

// ---------- 流水线进度 ----------
function iconFor(s) {
  if (s === 'done') return '<i class="ti ti-circle-check" aria-hidden="true"></i>';
  if (s === 'err') return '<i class="ti ti-alert-circle" aria-hidden="true"></i>';
  return '<i class="ti ti-loader-2 spin" aria-hidden="true"></i>';
}
function showRun() { const el = $('#run-status'); el.hidden = false; el.innerHTML = ''; }
function runLine(text, s) {
  const el = $('#run-status');
  const div = document.createElement('div');
  div.className = 'run-line ' + (s || 'busy');
  div.innerHTML = iconFor(s) + ' <span>' + esc(text) + '</span>';
  el.appendChild(div);
  return div;
}
function setLine(div, s, text) {
  if (!div) return;
  div.className = 'run-line ' + s;
  div.innerHTML = iconFor(s) + ' <span>' + esc(text) + '</span>';
}

// ---------- 联网检索(多检索词聚合 + 去重)----------
async function searchAll(queries, settings, restrict) {
  const opts = restrict ? { includeDomains: LAW_DOMAINS } : {};
  const lists = await Promise.all(
    queries.slice(0, 6).map((q) => searchRegulations(q, settings, opts).catch(() => []))
  );
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const res of (list || [])) {
      if (!res || !res.url || seen.has(res.url)) continue;
      seen.add(res.url);
      out.push({
        id: nextRegId(), title: res.title || '(无标题)', clauseNo: '',
        quote: res.content || '', url: res.url || '', source: res.source || '',
        origin: 'search', selected: true, verified: false,
      });
      if (out.length >= 14) return out;
    }
  }
  return out;
}

// ---------- 全自动审查流水线 ----------
async function runAutoFlow() {
  const settings = getSettings();
  if (!settings.modelKey) { toast('请先在「设置」中填写 AI 模型 API Key', true); openSettings(); return; }
  if (state.doc.status !== 'ready' || !state.doc.text) { toast('请先上传或粘贴制度文件', true); return; }

  gotoStep(2); // 进入「分析」步
  showRun();

  try {
    // 1) 提取检索词
    const l1 = runLine('正在分析制度,判断它受哪些法律法规约束…');
    let queries = [];
    try { queries = await extractQueries({ docText: state.doc.text, settings }); } catch (e) { /* 走兜底 */ }
    if (!queries.length) {
      queries = [(state.doc.name || '制度').replace(/\.[^.]+$/, '') + ' 法律 法规 监管办法'];
    }
    setLine(l1, 'done', '已确定 ' + queries.length + ' 个检索方向:' + queries.slice(0, 5).join(' / '));

    // 2) 内置权威法规库(主审查只用库,聚焦去噪;联网走「补搜并重审」按钮)
    const lLib = runLine('正在匹配内置权威法规库…');
    let regs = [];
    try {
      regs = await selectLibraryClauses(state.doc.text, queries, 28);
      setLine(lLib, 'done', '命中内置法规库 ' + regs.length + ' 条条款(联网补充可在报告页点「补搜并重审」)');
    } catch (e) {
      setLine(lLib, 'err', '法规库加载失败:' + (e.message || e));
    }

    if (regs.length === 0) {
      runLine('未匹配到任何法规。请确认法规库已加载。', 'err');
      $('#btn-prev').style.visibility = 'visible';
      return;
    }
    state.regs = regs;

    // 3) AI 审查(第一遍:全文体检)
    reviewCount++;
    state.round = reviewCount;
    state.mode = 'full';
    const l3 = runLine('AI 正在逐条审查(对照 ' + regs.length + ' 条法规)…');
    const result = await runReview({ docText: state.doc.text, regs, mode: state.mode, settings, round: state.round });
    setLine(l3, 'done', '初审完成,发现 ' + (result.findings || []).length + ' 个风险点');

    // 3b) 查漏复审(第二遍:专找遗漏)
    const lc = runLine('正在二次查漏复审(专找被忽略的遗漏)…');
    try {
      const extra = await reviewCritic({ docText: state.doc.text, regs, existing: result.findings, settings, round: state.round });
      const before = (result.findings || []).length;
      result.findings = mergeFindings(result.findings, extra.findings);
      result.summary = recomputeSummary(result.findings);
      setLine(lc, 'done', '复审补充 ' + Math.max(0, result.findings.length - before) + ' 条,合计 ' + result.findings.length + ' 条');
    } catch (e) {
      setLine(lc, 'err', '复审跳过(不影响初审结果):' + (e.message || e));
    }
    state.result = result;

    // 4) 渲染报告
    renderBasis(regs);
    renderReport($('#report-root'), result, buildCtx());
    applyEmptyState(result);
    renderCoverage(result.coverage);
    wireExportButton();
    gotoStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    runLine('出错:' + (e.message || String(e)), 'err');
    $('#btn-prev').style.visibility = 'visible';
  }
}

// ---------- 审查依据清单(报告页顶部)----------
function renderBasis(regs) {
  const el = $('#review-basis');
  if (!regs || !regs.length) { el.innerHTML = ''; return; }
  // 按法规分组(同一部法规的多条条款合并为一行)
  const byReg = new Map();
  regs.forEach((r) => {
    const key = r.title || r.source || '其他';
    if (!byReg.has(key)) byReg.set(key, { title: key, url: r.url, origin: r.origin, clauses: [] });
    if (r.clauseNo) byReg.get(key).clauses.push(r.clauseNo);
  });
  const items = [...byReg.values()].map((g) => {
    const originTag = g.origin === 'lib'
      ? '<span class="basis-src basis-lib">内置库</span>'
      : '<span class="basis-src basis-web">联网</span>';
    const cnt = g.clauses.length ? ' <span class="basis-src">' + g.clauses.length + ' 条</span>' : '';
    return '<li>' +
      (g.url
        ? '<a class="lk" href="' + esc(g.url) + '" target="_blank" rel="noopener">' + esc(g.title) + ' <i class="ti ti-external-link" aria-hidden="true"></i></a>'
        : esc(g.title)) +
      cnt + ' ' + originTag + '</li>';
  }).join('');
  el.innerHTML =
    '<details class="basis" open><summary><i class="ti ti-books" aria-hidden="true"></i> 审查依据' +
    help('本次纳入对照的法规清单;标「内置库」的来自内置权威法规库,标「联网」的为联网补充检索。') +
    ':本次纳入 ' + byReg.size + ' 部法规、' + regs.length + ' 条条款(点开查看 / 核对来源)</summary>' +
    '<ul class="basis-list">' + items + '</ul></details>';
}

// ---------- 审查覆盖·逐条对照(哪条用什么法规查的)----------
function covStatusBadge(s) {
  const map = {
    compliant: ['合规', 'cov-ok'], risk: ['有风险', 'cov-risk'],
    partial: ['部分覆盖', 'cov-partial'], not_covered: ['未覆盖', 'cov-none'],
  };
  const m = map[s] || ['—', 'cov-none'];
  return '<span class="cov-badge ' + m[1] + '">' + m[0] + '</span>';
}
function renderCoverage(coverage) {
  const el = $('#coverage');
  if (!coverage || !coverage.length) { el.innerHTML = ''; return; }
  const rows = coverage.map((c) => {
    const against = Array.isArray(c.checked_against)
      ? c.checked_against.map((x) => esc(x)).join('、')
      : esc(c.checked_against || '');
    return '<tr>' +
      '<td class="cov-clause">' + esc(c.clause || '') +
        (c.topic ? '<span class="cov-topic">' + esc(c.topic) + '</span>' : '') + '</td>' +
      '<td>' + (against || '—') + '</td>' +
      '<td>' + covStatusBadge(c.status) + '</td>' +
      '<td class="cov-note">' + esc(c.note || '') + '</td>' +
    '</tr>';
  }).join('');
  el.innerHTML =
    '<details class="coverage" open><summary><i class="ti ti-list-check" aria-hidden="true"></i> 审查覆盖 · 逐条对照' +
    help('受审文本每一处用了哪些法规核对、结论如何(合规 / 有风险 / 部分覆盖 / 未覆盖),体现审查的全面性。') +
    '(' + coverage.length + ' 项):每条用了什么法规核对、结论如何</summary>' +
    '<div class="cov-wrap"><table class="cov-table"><thead><tr>' +
      '<th>受审文本条款</th><th>核对依据(外规)</th><th>结论</th><th>说明</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

// ---------- 无风险时的「审查通过」正向反馈 ----------
function passCardHTML(regs) {
  const list = (regs || []).map((r) =>
    '<li>' + (r.url
      ? '<a class="lk" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + ' <i class="ti ti-external-link" aria-hidden="true"></i></a>'
      : esc(r.title)) + '</li>'
  ).join('');
  return '<div class="pass-card">' +
    '<div class="pass-head"><i class="ti ti-shield-check" aria-hidden="true"></i> 审查通过 · 未发现与现行法规冲突的条款</div>' +
    '<p class="pass-sub">已对照以下 ' + (regs ? regs.length : 0) + ' 部法律法规逐条核对,你的制度在这些规定下未见明显风险。</p>' +
    (list ? '<ul class="pass-list">' + list + '</ul>' : '') +
    '<p class="pass-note"><i class="ti ti-info-circle" aria-hidden="true"></i> 本结论以本次检索到的法规为准;如需更全面,可用下方「补搜并重审」纳入更多法规。</p>' +
  '</div>';
}
// 若本轮无风险点,把报告里默认的「未发现明显风险点」替换为正向反馈卡
function applyEmptyState(result) {
  if ((result.findings || []).length) return;
  const emptyEl = document.querySelector('#report-root .empty');
  if (emptyEl) emptyEl.outerHTML = passCardHTML(state.regs);
}

// ---------- 一键下载 PDF(无需打印弹窗)----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('PDF 组件加载失败,请检查网络'));
    document.head.appendChild(s);
  });
}
async function exportPdfDownload() {
  const btn = $('#btn-download-pdf');
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ti ti-loader-2 spin" aria-hidden="true"></i> 生成中…'; }
  const stage = $('#step-2');
  try {
    if (!window.html2pdf) {
      await loadScript('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js');
    }
    const name = (state.doc.name || '审查报告').replace(/\.[^.]+$/, '');
    let date = '';
    try { date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-'); } catch (e) { /* 忽略 */ }
    const filename = 'LexScope审查报告-' + name + (date ? '-' + date : '') + '.pdf';
    stage.classList.add('exporting');
    await window.html2pdf().set({
      margin: [8, 8, 10, 8],
      filename,
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] },
    }).from(stage).save();
    toast('PDF 已下载');
  } catch (e) {
    toast('生成 PDF 失败:' + (e.message || String(e)), true);
  } finally {
    stage.classList.remove('exporting');
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}
// 用「下载 PDF」替换报告里默认的「导出 PDF(打印)」按钮
function wireExportButton() {
  const html = '<button class="btn btn-primary" id="btn-download-pdf"><i class="ti ti-file-type-pdf" aria-hidden="true"></i> 导出 PDF</button>' +
    '<span class="pdf-tip">在弹出的打印窗口,「目标」选「另存为 PDF」即可(文字可选、法条链接可点)</span>';
  const actions = document.querySelector('#report-root .report-actions');
  if (actions) {
    actions.innerHTML = html;
  } else {
    const bar = document.createElement('div');
    bar.className = 'report-actions';
    bar.innerHTML = html;
    $('#report-root').prepend(bar);
  }
  const b = $('#btn-download-pdf');
  if (b) b.addEventListener('click', () => window.print());
}

// ---------- 报告交互回调 ----------
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
function makeFingerprint() {
  const s = getSettings();
  const urls = (state.regs || []).map((r) => r.url).join('|');
  const h = hashStr(state.doc.name + state.doc.text.length + urls + s.modelName);
  return h.slice(0, 4) + '…' + h.slice(-4);
}
function buildCtx() {
  return {
    docText: state.doc.text,
    fileName: state.doc.name,
    modelName: getSettings().modelName,
    round: state.round,
    fingerprint: makeFingerprint(),
    regCount: (state.regs || []).length,
    onAdopt: () => {},
    onIgnore: () => {},
    onReReview: async (keywords) => {
      const settings = getSettings();
      toast('正在补搜并重审…');
      try {
        const more = await searchAll(
          (keywords && keywords.length) ? keywords : ['相关 法律 法规 监管办法'],
          settings, true
        );
        const seen = new Set((state.regs || []).map((r) => r.url));
        more.forEach((r) => { if (r.url && !seen.has(r.url)) { seen.add(r.url); state.regs.push(r); } });
        reviewCount++;
        state.round = reviewCount;
        const result = await runReview({ docText: state.doc.text, regs: state.regs, mode: state.mode || 'fast', settings, round: state.round });
        state.result = result;
        renderBasis(state.regs);
        renderReport($('#report-root'), result, buildCtx());
        applyEmptyState(result);
        renderCoverage(result.coverage);
        wireExportButton();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('已补搜并重审(共 ' + state.regs.length + ' 部法规)');
      } catch (e) {
        toast('补搜重审失败:' + (e.message || String(e)), true);
      }
    },
  };
}

// ---------- 打印 / 另存为 PDF:给保存的文件预填友好文件名 ----------
function bindPrintFilename() {
  let orig = '';
  window.addEventListener('beforeprint', () => {
    orig = document.title;
    const name = (state.doc.name || '审查报告').replace(/\.[^.]+$/, '');
    let date = '';
    try { date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-'); } catch (e) { /* 忽略 */ }
    document.title = 'LexScope审查报告-' + name + (date ? '-' + date : '');
  });
  window.addEventListener('afterprint', () => { if (orig) document.title = orig; });
}

// ---------- 重新开始(顶部常驻)----------
function resetAll() {
  state.doc = { name: '', text: '', status: 'empty' };
  state.regs = [];
  state.result = null;
  state.round = 1;
  reviewCount = 0;
  const fs = $('#file-status'); fs.hidden = true; fs.innerHTML = '';
  $('#file-input').value = '';
  $('#paste-text').value = '';
  const rs = $('#run-status'); rs.hidden = true; rs.innerHTML = '';
  $('#review-basis').innerHTML = '';
  $('#report-root').innerHTML = '';
  $('#coverage').innerHTML = '';
  gotoStep(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function bindRestart() {
  $('#btn-restart').addEventListener('click', () => {
    if (state.result || state.doc.status === 'ready') {
      if (!window.confirm('确定要新建审查吗?当前审查结果将清空。')) return;
    }
    resetAll();
  });
}

// ---------- 导航 ----------
function bindNav() {
  $('#btn-next').addEventListener('click', () => { if (currentStep === 1) runAutoFlow(); });
  $('#btn-prev').addEventListener('click', () => { gotoStep(1); });
}

// ---------- utils ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function help(tip) { return '<span class="help" title="' + esc(tip) + '"><i class="ti ti-help-circle" aria-hidden="true"></i></span>'; }

// ---------- init ----------
function init() {
  bindSettings();
  bindHelp();
  bindUpload();
  bindNav();
  bindRestart();
  bindPrintFilename();
  gotoStep(1);
  const s = getSettings();
  if (!s.modelKey || !s.searchKey) openSettings();
}
init();
