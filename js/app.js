// app.js — 集成层:设置、上传、全自动审查流水线、报告联动
import { state, nextRegId } from './state.js';
import { getSettings, saveSettings, LAW_DOMAINS } from './config.js';
import { parseFile } from './parse.js';
import { searchRegulations } from './search.js';
import { runReview, extractQueries } from './review.js';
import { renderReport } from './report.js';

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
function openSettings() { $('#settings').hidden = false; loadSettingsToForm(); }
function bindSettings() {
  $('#btn-settings').addEventListener('click', () => {
    const p = $('#settings');
    p.hidden = !p.hidden;
    if (!p.hidden) loadSettingsToForm();
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
    const tip = $('#settings-saved');
    tip.hidden = false;
    setTimeout(() => { tip.hidden = true; }, 1800);
  });
}

// ---------- 步骤导航(两步:上传 / 报告)----------
function gotoStep(n) {
  currentStep = n;
  $('#step-1').hidden = (n !== 1);
  $('#step-2').hidden = (n !== 2);
  document.querySelectorAll('.stepper .si').forEach((si) => {
    const s = +si.dataset.s;
    si.classList.toggle('on', s === n);
    si.classList.toggle('done', s < n);
  });
  const prev = $('#btn-prev'), next = $('#btn-next');
  if (n === 2) {
    next.style.visibility = 'hidden';
    prev.style.visibility = 'visible';
  } else {
    next.style.visibility = 'visible';
    next.disabled = false;
    next.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> 开始审查';
    prev.style.visibility = 'hidden';
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
  if (!settings.searchKey) { toast('请先在「设置」中填写联网搜索 API Key', true); openSettings(); return; }
  if (state.doc.status !== 'ready' || !state.doc.text) { toast('请先上传或粘贴制度文件', true); return; }

  const next = $('#btn-next');
  next.disabled = true;
  next.innerHTML = '<i class="ti ti-loader-2 spin" aria-hidden="true"></i> 审查中…';
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

    // 2) 联网检索(优先权威来源,空则放宽)
    let l2 = runLine('正在权威立法 / 监管来源中联网检索…');
    let regs = await searchAll(queries, settings, true);
    if (regs.length === 0) {
      setLine(l2, 'busy', '权威来源未命中,放宽范围再检索…');
      regs = await searchAll(queries, settings, false);
    }
    if (regs.length === 0) {
      setLine(l2, 'err', '未检索到相关法规。请检查「联网搜索 Key / 转发前缀」,或改用更具体的制度文本。');
      next.disabled = false;
      next.innerHTML = '<i class="ti ti-refresh" aria-hidden="true"></i> 重试';
      return;
    }
    state.regs = regs;
    setLine(l2, 'done', '已纳入 ' + regs.length + ' 部权威法规');

    // 3) AI 审查
    const l3 = runLine('AI 正在逐条审查(对照 ' + regs.length + ' 部法规)…');
    reviewCount++;
    state.round = reviewCount;
    state.mode = 'fast';
    const result = await runReview({ docText: state.doc.text, regs, mode: state.mode, settings, round: state.round });
    state.result = result;
    const n = (result.findings || []).length;
    setLine(l3, 'done', '审查完成,发现 ' + n + ' 个风险点');

    // 4) 渲染报告
    renderBasis(regs);
    renderReport($('#report-root'), result, buildCtx());
    gotoStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    runLine('出错:' + (e.message || String(e)), 'err');
    next.disabled = false;
    next.innerHTML = '<i class="ti ti-refresh" aria-hidden="true"></i> 重试';
  }
}

// ---------- 审查依据清单(报告页顶部)----------
function renderBasis(regs) {
  const el = $('#review-basis');
  if (!regs || !regs.length) { el.innerHTML = ''; return; }
  const items = regs.map((r) =>
    '<li>' +
      (r.url
        ? '<a class="lk" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.title) + ' <i class="ti ti-external-link" aria-hidden="true"></i></a>'
        : esc(r.title)) +
      (r.source ? ' <span class="basis-src">' + esc(r.source) + '</span>' : '') +
    '</li>'
  ).join('');
  el.innerHTML =
    '<details class="basis" open><summary><i class="ti ti-books" aria-hidden="true"></i> 审查依据:本次自动纳入 ' + regs.length + ' 部权威法规(点开查看 / 核对来源)</summary>' +
    '<ul class="basis-list">' + items + '</ul></details>';
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
    onEdit: (id) => {
      const f = (state.result.findings || []).find((x) => x.id === id);
      if (!f) return;
      const nextText = window.prompt('修改建议文本:', f.suggestion || '');
      if (nextText == null) return;
      f.suggestion = nextText;
      const p = document.querySelector('#card-' + id + ' .suggestion p');
      if (p) p.textContent = nextText;
    },
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
        window.scrollTo({ top: 0, behavior: 'smooth' });
        toast('已补搜并重审(共 ' + state.regs.length + ' 部法规)');
      } catch (e) {
        toast('补搜重审失败:' + (e.message || String(e)), true);
      }
    },
  };
}

// ---------- 导航 ----------
function bindNav() {
  $('#btn-next').addEventListener('click', () => { if (currentStep === 1) runAutoFlow(); });
  $('#btn-prev').addEventListener('click', () => { if (currentStep === 2) gotoStep(1); });
}

// ---------- utils ----------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- init ----------
function init() {
  bindSettings();
  bindUpload();
  bindNav();
  gotoStep(1);
  const s = getSettings();
  if (!s.modelKey || !s.searchKey) openSettings();
}
init();
