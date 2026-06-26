// lawlib.js — 内置法规库的加载与本地检索(混合路线的"底座")
// 从 data/laws.json 加载条款级真实条文,按主题/字面相关度挑出与制度最相关的条款。

let _cache = null;

export async function loadLawLib() {
  if (_cache) return _cache;
  const res = await fetch('data/laws.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('法规库 data/laws.json 加载失败(HTTP ' + res.status + ')');
  _cache = await res.json();
  return _cache;
}

// 取中文 2-gram 集合(去标点/空白),用于无分词环境下的字面相关度
function grams(s) {
  const t = String(s == null ? '' : s).replace(/[\s　]|[\p{P}]/gu, '');
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}

/**
 * 按制度全文 + 检索词,从法规库挑出最相关的条款。
 * @param {string} docText 内规全文
 * @param {string[]} queries 检索词(extractQueries 产出)
 * @param {number} limit 返回条款上限
 * @returns {Promise<Array>} 形如 review/report 所需的 reg 数组(每条=一个法条)
 */
export async function selectLibraryClauses(docText, queries, limit = 50, categories = null) {
  const lib = await loadLawLib();
  const ref = (docText || '').slice(0, 5000) + ' ' + (queries || []).join(' ');
  const dg = grams(ref);

  // 适用法域过滤:有传 categories 时,只保留与"适用法域 + 通用"相交的法规
  const applySet = (Array.isArray(categories) && categories.length)
    ? new Set([...categories, '通用'])
    : null;

  const scored = [];
  for (const reg of (lib.regulations || [])) {
    if (applySet) {
      const regCats = (reg.categories && reg.categories.length) ? reg.categories : ['通用'];
      if (!regCats.some((c) => applySet.has(c))) continue; // 不在适用法域,跳过
    }
    for (const c of (reg.clauses || [])) {
      const cg = grams((c.topic || '') + (c.text || ''));
      let overlap = 0;
      for (const g of cg) if (dg.has(g)) overlap++;
      if (overlap <= 0) continue;
      // 归一化,避免超长条款(如带大段列举的)单纯靠长度霸榜
      const score = overlap / Math.sqrt(cg.size || 1);
      scored.push({ reg, c, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  let seq = 0;
  return scored.slice(0, limit).map((x) => ({
    id: 'L' + (++seq),
    title: x.reg.short_name || x.reg.name,
    fullName: x.reg.name,
    clauseNo: x.c.no,
    quote: x.c.text,
    url: x.reg.source_url,
    source: x.reg.short_name || x.reg.name,
    version_date: x.reg.version_date || '',
    origin: 'lib',
    selected: true,
    verified: true,
  }));
}

export async function lawLibMeta() {
  const lib = await loadLawLib();
  const regs = lib.regulations || [];
  return {
    version: lib.version || '',
    regCount: regs.length,
    clauseCount: regs.reduce((s, r) => s + (r.clauses ? r.clauses.length : 0), 0),
  };
}
