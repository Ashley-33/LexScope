// state.js — 全局状态(仅内存,刷新即清空,符合“无存储”定位)
// 模块契约:各模块只通过 import { state } 读写,不持久化。

export const state = {
  doc: { name: '', text: '', status: 'empty' }, // status: empty|parsing|ready|error
  // regs: 检索到/手动添加的外规。selected 决定是否纳入审查。
  // 字段: { id, title, clauseNo, quote, url, source, origin:'search'|'manual', selected, verified }
  regs: [],
  mode: 'fast',           // fast | full
  result: null,           // { summary, findings, suggestedSearches }
  round: 1,
  reviewing: false,
};

let _seq = 0;
export function nextRegId() { _seq += 1; return 'W' + _seq; }

export function selectedRegs() { return state.regs.filter(r => r.selected); }

export function resetResult() { state.result = null; }
