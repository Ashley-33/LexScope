// app.js — 集成层:设置、步骤导航、上传、检索、审查、报告联动
import { state, nextRegId, selectedRegs, resetResult } from './state.js';
import { getSettings, saveSettings } from './config.js';
import { parseFile } from './parse.js';
import { searchRegulations } from './search.js';
import { runReview } from './review.js';
import { renderReport, exportPDF } from './report.js';

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
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
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

// ---------- 步骤导航 ----------
function gotoStep(n) {
  currentStep = n;
  [1, 2, 3].forEach((i) => { $('#step-' + i).hidden = (i !== n); });
  document.querySelectorAll('.stepper .si').forEach((si) => {
    const s = +si.dataset.s;
    si.classList.toggle('on', s === n);
    si.classList.toggle('done', s < n);
  });
  $('#btn-prev').style.visibility = n > 1 ? 'visible' : 'hidden';
  const next = $('#btn-next');
  if (n === 3) {
    next.style.visibility = 'hidden';
  } else {
    next.style.visibility = 'visible';
    next.disabled = false;
    next.innerHTML = (n === 1 ? '去联网选规' : '生成审查报告') +
      ' <i class="ti ti-arrow-right" aria-hidden="true"></i>';
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
    setFileStatus('<i class="ti ti-file-check"></i> ' + esc(name) +
      ' 已就绪(' + text.length + ' 字)', 'ok');
    prefillQuery();
  } catch (e) {
    state.doc.status = 'error';
    setFileStatus('<i class="ti ti-alert-circle"></i> 解析失败:' + esc(e.message || String(e)), 'err');
  }
}
function prefillQuery() {
  if ($('#search-query').value.trim()) return;
  const base = (state.doc.name || '').replace(/\.[^.]+$/, '').slice(0, 30);
  $('#search-query').value = (base + ' 监管 法规 合规').trim();
}
function bindUpload() {
  const dz = $('#dropzone');
  const input = $('#file-input');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  input.addEventListener('change', () => handleFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  $('#btn-use-paste').addEventListener('click', () => {
    const txt = $('#paste-text').value.trim();
    if (!txt) { toast('请先粘贴文本', true); return; }
    state.doc = { name: '粘贴文本.txt', text: txt, status: 'ready' };
    setFileStatus('<i class="ti ti-file-check"></i> 已使用粘贴文本(' + txt.length + ' 字)', 'ok');
    prefillQuery();
  });
}

// ---------- 步骤2:网络选规 ----------
function renderRegList() {
  const list = $('#reg-list');
  list.innerHTML = '';
  state.regs.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'reg-row';
    row.innerHTML =
      '<input type="checkbox" ' + (r.selected ? 'checked' : '') + ' data-id="' + r.id + '">' +
      '<div class="reg-main">' +
        '<div class="reg-title">' + esc(r.title) +
          (r.clauseNo ? ' <span class="clause">' + esc(r.clauseNo) + '</span>' : '') + '</div>' +
        (r.quote ? '<div class="reg-snippet">' + esc(r.quote) + '</div>' : '') +
      '</div>' +
      '<div class="reg-side">' +
        (r.origin === 'manual'
          ? '<span class="badge manual">手动添加</span>'
          : '<span class="badge law">' + esc(r.source || '来源') + '</span>') +
        (r.url ? '<a class="lk" href="' + esc(r.url) + '" target="_blank" rel="noopener">原文 <i class="ti ti-external-link"></i></a>' : '') +
        '<button class="reg-del" data-del="' + r.id + '" aria-label="删除"><i class="ti ti-trash"></i></button>' +
      '</div>';
    list.appendChild(row);
  });
  list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const r = state.regs.find((x) => x.id === cb.dataset.id);
      if (r) r.selected = cb.checked;
      updateSelCount();
    });
  });
  list.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      state.regs = state.regs.filter((x) => x.id !== b.dataset.del);
      renderRegList(); updateSelCount();
    });
  });
  updateSelCount();
}
function updateSelCount() { $('#sel-count').textContent = selectedRegs().length; }

async function doSearch() {
  const settings = getSettings();
  if (!settings.searchKey) {
    toast('请先在「设置」中填写联网搜索 API Key', true);
    $('#settings').hidden = false; loadSettingsToForm(); return;
  }
  const query = $('#search-query').value.trim();
  if (!query) { toast('请输入检索关键词', true); return; }
  const status = $('#search-status');
  status.className = 'search-status';
  status.textContent = 'AI 正在联网检索权威法规来源…';
  $('#btn-search').disabled = true;
  try {
    const results = await searchRegulations(query, settings);
    const existing = new Set(state.regs.map((r) => r.url));
    let added = 0;
    results.forEach((res) => {
      if (res.url && existing.has(res.url)) return;
      existing.add(res.url);
      state.regs.push({
        id: nextRegId(), title: res.title || '(无标题)', clauseNo: '',
        quote: res.content || '', url: res.url || '', source: res.source || '',
        origin: 'search', selected: true, verified: false,
      });
      added++;
    });
    renderRegList();
    status.className = 'search-status ok';
    status.innerHTML = '<i class="ti ti-circle-check"></i> 检索完成,新增 ' + added +
      ' 条(勾选纳入审查,可点「原文」先核对)。';
  } catch (e) {
    status.className = 'search-status err';
    status.textContent = '检索失败:' + (e.message || String(e));
  } finally {
    $('#btn-search').disabled = false;
  }
}

function bindStep2() {
  $('#btn-search').addEventListener('click', doSearch);
  $('#search-query').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
  $('#btn-manual-toggle').addEventListener('click', () => {
    const f = $('#manual-form'); f.hidden = !f.hidden;
  });
  $('#btn-manual-add').addEventListener('click', () => {
    const name = $('#manual-name').value.trim();
    const quote = $('#manual-quote').value.trim();
    if (!name || !quote) { toast('法规名称与条文原文为必填', true); return; }
    state.regs.push({
      id: nextRegId(), title: name, clauseNo: $('#manual-clause').value.trim(),
      quote, url: $('#manual-url').value.trim(), source: '手动', origin: 'manual',
      selected: true, verified: true,
    });
    $('#manual-name').value = ''; $('#manual-clause').value = '';
    $('#manual-url').value = ''; $('#manual-quote').value = '';
    $('#manual-form').hidden = true;
    renderRegList();
    toast('已添加到清单');
  });
  $('#mode-select').addEventListener('change', () => { state.mode = $('#mode-select').value; });
}

// ---------- 步骤3:审查 + 报告 ----------
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
function makeFingerprint() {
  const s = getSettings();
  const urls = selectedRegs().map((r) => r.url).join('|');
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
    regCount: selectedRegs().length,
    onAdopt: () => {},
    onIgnore: () => {},
    onEdit: (id) => {
      const f = (state.result.findings || []).find((x) => x.id === id);
      if (!f) return;
      const next = window.prompt('修改建议文本:', f.suggestion || '');
      if (next == null) return;
      f.suggestion = next;
      const p = document.querySelector('#card-' + id + ' .suggestion p');
      if (p) p.textContent = next;
    },
    onReReview: async (keywords) => {
      gotoStep(2);
      $('#search-query').value = (keywords || []).join(' ');
      toast('已带入补搜关键词,检索后请重新点「生成审查报告」');
    },
  };
}
async function runReviewFlow() {
  const settings = getSettings();
  if (!settings.modelKey) {
    toast('请先在「设置」中填写 AI 模型 API Key', true);
    $('#settings').hidden = false; loadSettingsToForm(); return;
  }
  if (!state.doc.text) { toast('请先上传/解析制度文件', true); return; }
  if (selectedRegs().length === 0) { toast('请至少勾选 1 条外规', true); return; }

  state.mode = $('#mode-select').value;
  reviewCount++;
  state.round = reviewCount;
  const next = $('#btn-next');
  next.disabled = true;
  next.innerHTML = '<i class="ti ti-loader-2 spin"></i> AI 审查中…';
  try {
    const result = await runReview({
      docText: state.doc.text, regs: selectedRegs(), mode: state.mode,
      settings, round: state.round,
    });
    state.result = result;
    renderReport($('#report-root'), result, buildCtx());
    gotoStep(3);
  } catch (e) {
    toast('审查失败:' + (e.message || String(e)), true);
    next.disabled = false;
    next.innerHTML = '生成审查报告 <i class="ti ti-arrow-right"></i>';
  }
}

// ---------- next/prev ----------
function bindNav() {
  $('#btn-next').addEventListener('click', () => {
    if (currentStep === 1) {
      if (state.doc.status !== 'ready') { toast('请先上传并解析制度文件', true); return; }
      gotoStep(2);
    } else if (currentStep === 2) {
      runReviewFlow();
    }
  });
  $('#btn-prev').addEventListener('click', () => { if (currentStep > 1) gotoStep(currentStep - 1); });
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
  bindStep2();
  bindNav();
  gotoStep(1);
  // 首次无密钥时,自动展开设置引导
  const s = getSettings();
  if (!s.modelKey || !s.searchKey) { $('#settings').hidden = false; loadSettingsToForm(); }
}
window.__exportPDF = exportPDF; // 便于调试
init();
